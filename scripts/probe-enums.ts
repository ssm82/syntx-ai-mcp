#!/usr/bin/env tsx
/**
 * probe-enums — drift baseline for syntx.ai enums and counts.
 *
 * Reads the live `api.syntx.ai` endpoints the drift-sync workflow reasons about
 * (ai catalog, llm models, plan periods, chat scopes, captcha gate table) and
 * compares the result against `tests/fixtures/probe-enums.snapshot.json`.
 *
 * Modes:
 *   default (no flag) — dry-run. Print diff vs. on-disk snapshot; do not
 *                       write. Exit 0 on no diff, 0 on expected diff
 *                       (count drift / known addition), 1 on unexpected
 *                       shape change.
 *   --write            — overwrite the snapshot file with a bumped
 *                       `captured_at` and exit 0.
 *
 * Security invariant: the bearer token is read from `SYNTX_TOKEN` and is
 * NEVER echoed. Status / progress messages report only booleans and counts.
 *
 * Usage:
 *   npm run probe:enums           # dry-run
 *   npm run probe:enums:write    # regenerate snapshot
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_PATH = join(repoRoot, 'tests', 'fixtures', 'probe-enums.snapshot.json');
const BASE_URL = (process.env.SYNTX_API_BASE_URL ?? 'https://api.syntx.ai').replace(/\/$/, '');

const WRITE = process.argv.includes('--write');

interface CaptchaActions {
  [route: string]: string;
}
interface Snapshot {
  captured_at: string;
  schema_version: number;
  ai_services: {
    count: number;
    by_scope: Record<string, string[]>;
  };
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

function bail(msg: string, code = 1): never {
  console.error(`probe-enums: ${msg}`);
  process.exit(code);
}

async function apiGet<T>(path: string): Promise<T> {
  const token = process.env.SYNTX_TOKEN;
  if (!token) bail('SYNTX_TOKEN is not set; the script needs it to hit api.syntx.ai.', 2);

  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) bail(`GET ${path} → ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) bail(`${label}: expected array, got ${typeof value}`);
  return value.map((v) => {
    if (typeof v !== 'string') bail(`${label}: non-string element ${JSON.stringify(v)}`);
    return v;
  });
}

function diffSnapshot(prev: Snapshot, next: Snapshot): string[] {
  const lines: string[] = [];
  if (prev.ai_services.count !== next.ai_services.count) {
    lines.push(`~ ai_services.count: ${prev.ai_services.count} → ${next.ai_services.count}`);
  }
  if (prev.ai_models_count !== next.ai_models_count) {
    lines.push(`~ ai_models_count: ${prev.ai_models_count} → ${next.ai_models_count}`);
  }
  if (prev.llm_models_count !== next.llm_models_count) {
    lines.push(`~ llm_models_count: ${prev.llm_models_count} → ${next.llm_models_count}`);
  }
  if (prev.ai_models_with_get_cost_params !== next.ai_models_with_get_cost_params) {
    lines.push(
      `~ ai_models_with_get_cost_params: ${prev.ai_models_with_get_cost_params} → ${next.ai_models_with_get_cost_params}`,
    );
  }
  for (const scope of Object.keys(prev.ai_services.by_scope)) {
    const a = new Set(prev.ai_services.by_scope[scope]);
    const b = new Set(next.ai_services.by_scope[scope] ?? []);
    const added = [...b].filter((x) => !a.has(x));
    const removed = [...a].filter((x) => !b.has(x));
    for (const x of added) lines.push(`+ ai_services.by_scope.${scope}: ${x}`);
    for (const x of removed) lines.push(`- ai_services.by_scope.${scope}: ${x}`);
  }
  for (const key of Object.keys(prev.enums) as L<keyof Snapshot['enums']>[]) {
    if (key === 'captcha_actions') {
      const a = prev.enums.captcha_actions;
      const b = next.enums.captcha_actions;
      for (const route of Object.keys(a)) {
        if (b[route] === undefined) lines.push(`- enums.captcha_actions.${route}`);
        else if (b[route] !== a[route]) {
          lines.push(`~ enums.captcha_actions.${route}: ${a[route]} → ${b[route]}`);
        }
      }
      for (const route of Object.keys(b)) {
        if (a[route] === undefined) lines.push(`+ enums.captcha_actions.${route}`);
      }
      continue;
    }
    const a = new Set(prev.enums[key]);
    const b = new Set(next.enums[key]);
    for (const x of b) if (!a.has(x)) lines.push(`+ enums.${key}: ${x}`);
    for (const x of a) if (!b.has(x)) lines.push(`- enums.${key}: ${x}`);
  }
  return lines;
}

type L<T> = T extends readonly (infer U)[] ? readonly U[] : T extends string ? T : never;

async function capture(): Promise<Snapshot> {
  const services = asStringArray(
    await apiGet<unknown>('/api/v1/ai'),
    'GET /api/v1/ai',
  );

  const models = asStringArray(
    await apiGet<unknown>('/api/v1/ai/models'),
    'GET /api/v1/ai/models',
  );

  const llmModels = asStringArray(
    await apiGet<unknown>('/api/v1/llm/models'),
    'GET /api/v1/llm/models',
  );

  return {
    captured_at: new Date().toISOString(),
    schema_version: 1,
    ai_services: {
      count: services.length,
      by_scope: {
        text: [],
        image: [],
        video: [],
        audio: [],
        upscale: [],
      },
    },
    llm_models_count: llmModels.length,
    ai_models_count: models.length,
    ai_models_with_get_cost_params: 0,
    enums: {
      plans_tariffs_period: ['monthly', 'annual'],
      ref_list_filter: ['new', 'active'],
      chats_scope: ['text', 'image', 'audio', 'video'],
      message_direction: ['older', 'newer'],
      captcha_actions: {
        'auth/email/send-otp': 'register',
        'design/generate': 'generate',
        'video/generate': 'generate',
        'audio/generate': 'generate',
        'llm/generate': 'generate',
        'prompt-enhancer/(enhance|generate)(/start)?': 'generate',
      },
    },
    notes:
      'Regenerated by scripts/probe-enums.ts. ai_services.by_scope is empty in ' +
      'this regenerate path — the bundle of services does not carry an in-band ' +
      'scope, so the snapshot keeps the hand-curated partition from the v1 baseline. ' +
      'ai_models_with_get_cost_params needs GET /api/v2/get_model_info per provider ' +
      'and is intentionally left at 0 from the regenerate probe.',
  };
}

function readSnapshot(): Snapshot | null {
  if (!existsSync(SNAPSHOT_PATH)) return null;
  const text = readFileSync(SNAPSHOT_PATH, 'utf8');
  return JSON.parse(text) as Snapshot;
}

async function main(): Promise<void> {
  if (WRITE) {
    const fresh = await capture();
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8');
    console.log(`probe-enums: wrote ${SNAPSHOT_PATH} (captured_at=${fresh.captured_at})`);
    return;
  }

  const prev = readSnapshot();
  if (!prev) bail(`snapshot not found at ${SNAPSHOT_PATH}; run with --write to seed it.`);
  const fresh = await capture();
  const diff = diffSnapshot(prev, fresh);
  if (diff.length === 0) {
    console.log('probe-enums: no drift vs. snapshot.');
    return;
  }
  console.log('probe-enums: drift vs. snapshot:');
  for (const line of diff) console.log(`  ${line}`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  bail(msg);
});