import { test } from 'node:test';
import assert from 'node:assert/strict';

import { allTools } from '../src/mcp/tools';
import { mergeModelCatalogs, normalizeLlmModel } from '../src/resources/ai';
import type { McpContext } from '../src/mcp/registry';
import type { AIModel, LlmModel } from '../src/types';

/**
 * The two upstream model catalogs are not in sync:
 *   • `GET /api/v1/ai/models`  — every media scope, keyed by `value`
 *   • `GET /api/v1/llm/models` — the text catalog, keyed by `id`
 *
 * The LLM catalog carries text models the general one does not
 * (`gpt-6.1-sol`, `gpt-6.1-terra`), and three models are enabled for text
 * but flagged inactive in the general catalog (`deepseek-r1`,
 * `gemini-3.7-flash`, `grok-4.6`). These tests pin the merge that keeps
 * both visible.
 */

function tool(name: string) {
  const found = allTools.find((t) => t.name === name);
  assert.ok(found, `tool not registered: ${name}`);
  return found;
}

const llmRow = (id: string, extra: Partial<LlmModel> = {}): LlmModel =>
  ({
    id,
    label: id.toUpperCase(),
    ai_name: 'chatgpt',
    enabled: true,
    default: false,
    description: null,
    context_window: 200000,
    default_max_tokens: 10000,
    capabilities: { thinking: true },
    supported_tools: ['run_code'],
    ...extra,
  }) as LlmModel;

const aiRow = (value: string, extra: Partial<AIModel> = {}): AIModel =>
  ({
    value,
    label: value,
    ai_name: 'chatgpt',
    active: true,
    default: false,
    description: null,
    type: null,
    settings: { uploadable: true },
    features: { files_processing: true },
    ...extra,
  }) as AIModel;

test('normalizeLlmModel projects an LLM row onto the shared AIModel shape', () => {
  const out = normalizeLlmModel(llmRow('gpt-6.1-sol'));

  // `id` becomes `value`, `enabled` becomes `active`.
  assert.equal(out.value, 'gpt-6.1-sol');
  assert.equal(out.active, true);
  assert.equal(out.label, 'GPT-6.1-SOL');
  assert.equal(out.ai_name, 'chatgpt');
  // The text-catalog-only fields survive under `llm`.
  assert.equal(out.llm?.context_window, 200000);
  assert.deepEqual(out.llm?.supported_tools, ['run_code']);
});

test('normalizeLlmModel maps a disabled LLM row to active: false', () => {
  const out = normalizeLlmModel(llmRow('old-model', { enabled: false }));
  assert.equal(out.active, false);
});

test('mergeModelCatalogs keeps models that only one catalog knows', () => {
  const merged = mergeModelCatalogs(
    [aiRow('gpt-6-sol')],
    [llmRow('gpt-6.1-sol'), llmRow('gpt-6.1-terra')],
  );
  const ids = merged.map((m) => m.value).sort();
  assert.deepEqual(ids, ['gpt-6-sol', 'gpt-6.1-sol', 'gpt-6.1-terra']);
});

test('mergeModelCatalogs lets the LLM catalog decide availability', () => {
  // `deepseek-r1` is enabled for text but flagged inactive in the general
  // catalog — the merged row must not inherit the inactive flag.
  const merged = mergeModelCatalogs(
    [aiRow('deepseek-r1', { active: false })],
    [llmRow('deepseek-r1', { ai_name: 'deepseek' })],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].active, true);
  assert.equal(merged[0].llm?.context_window, 200000);
});

test('mergeModelCatalogs keeps the general catalog upload metadata', () => {
  const merged = mergeModelCatalogs(
    [aiRow('gpt-6-sol', { settings: { uploadable: true, max_file_size: 5242880 } })],
    [llmRow('gpt-6-sol')],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].settings.uploadable, true);
  assert.equal(merged[0].settings.max_file_size, 5242880);
  // …and the text-catalog extras alongside it.
  assert.equal(merged[0].llm?.context_window, 200000);
});

test('mergeModelCatalogs does not duplicate models present in both catalogs', () => {
  const merged = mergeModelCatalogs(
    [aiRow('gpt-6-sol'), aiRow('gpt-6-luna')],
    [llmRow('gpt-6-sol'), llmRow('gpt-6-luna')],
  );
  assert.equal(merged.length, 2);
});

test('list-models exposes the `source` selector', () => {
  const t = tool('list-models');
  const schema = t.inputSchema as {
    properties: Record<string, { enum?: string[] }>;
    additionalProperties: boolean;
  };
  assert.deepEqual(schema.properties.source.enum, ['ai', 'llm', 'both']);
  assert.equal(schema.additionalProperties, false);
});

test('list-models rejects an unknown `source` instead of silently falling back', async () => {
  const t = tool('list-models');
  const ctx = {
    syntx: {
      ai: {
        listModels: async () => {
          throw new Error('must not be called');
        },
      },
      llm: {
        listModels: async () => {
          throw new Error('must not be called');
        },
      },
    },
  } as unknown as McpContext;

  const res = await t.handler({ source: 'bogus' }, ctx);
  assert.equal(res.isError, true);
  assert.match(
    (res.content[0] as { text: string }).text,
    /unknown source "bogus"/,
  );
});

/**
 * A mock context whose general catalog holds one model and whose text
 * catalog holds another, so the two sources can be told apart.
 */
function catalogContext() {
  const calls: string[] = [];
  const ctx = {
    syntx: {
      ai: {
        listModels: async () => {
          calls.push('ai');
          return [aiRow('gpt-6-sol')];
        },
        listServices: async () => [],
      },
      llm: {
        listModels: async () => {
          calls.push('llm');
          return [llmRow('gpt-6.1-sol')];
        },
      },
    },
  } as unknown as McpContext;
  return { ctx, calls };
}

async function listModels(args: Record<string, unknown>): Promise<string[]> {
  const t = tool('list-models');
  const { ctx } = catalogContext();
  const res = await t.handler(args, ctx);
  assert.notEqual(res.isError, true, (res.content[0] as { text: string }).text);
  const rows = JSON.parse((res.content[0] as { text: string }).text) as AIModel[];
  return rows.map((r) => r.value).sort();
}

test('the default catalog includes a model that exists only in the text catalog', async () => {
  // The general catalog alone does not know `gpt-6.1-sol`; the platform
  // catalog must still offer it, otherwise a client picking a model from
  // the default listing cannot use it.
  const ids = await listModels({});
  assert.deepEqual(ids, ['gpt-6-sol', 'gpt-6.1-sol']);
});

test('source "ai" is the platform catalog — general merged with the text catalog', async () => {
  const ids = await listModels({ source: 'ai' });
  assert.deepEqual(ids, ['gpt-6-sol', 'gpt-6.1-sol']);
});

test('source "both" is an explicit spelling of the platform catalog', async () => {
  const ids = await listModels({ source: 'both' });
  assert.deepEqual(ids, ['gpt-6-sol', 'gpt-6.1-sol']);
});

test('source "llm" stays the text catalog alone', async () => {
  const ids = await listModels({ source: 'llm' });
  assert.deepEqual(ids, ['gpt-6.1-sol']);
});
