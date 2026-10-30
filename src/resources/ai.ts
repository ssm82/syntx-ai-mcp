import { BaseClient } from '../client';
import type { AIService, AIModel, LlmModel } from '../types';

/**
 * Resource for AI services and models.
 */
export class AIResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * List all available AI services (e.g. Midjourney, Sora, Flux).
   * GET /api/v1/ai
   */
  async listServices(): Promise<AIService[]> {
    return this.client.get<AIService[]>('/api/v1/ai');
  }

  /**
   * List detailed AI models with upload constraints and features.
   * GET /api/v1/ai/models
   */
  async listModels(): Promise<AIModel[]> {
    return this.client.get<AIModel[]>('/api/v1/ai/models');
  }
}

/**
 * Project an LLM-catalog row onto the shared {@link AIModel} shape.
 *
 * The two upstream catalogs describe the same models with different key
 * names — the LLM catalog is keyed by `id` / `enabled`, the AI catalog by
 * `value` / `active`. Normalising here means every consumer (MCP tools,
 * SDK callers) sees one shape, and `value` is always the model identifier.
 *
 * The LLM-only fields are preserved verbatim under `llm` so nothing is
 * lost in the projection.
 */
export function normalizeLlmModel(row: LlmModel): AIModel {
  return {
    value: row.id,
    label: row.label,
    ai_name: row.ai_name,
    active: row.enabled !== false,
    default: row.default === true,
    description: row.description ?? null,
    type: null,
    // The AI catalog's `settings` block has no LLM equivalent — the
    // text-specific values (context window, subscription gate) live under
    // `llm` instead.
    settings: {},
    features: row.capabilities ?? null,
    llm: row,
  };
}

/**
 * Merge the two upstream model catalogs into one list.
 *
 * `GET /api/v1/ai/models` is the general catalog (every media scope) and
 * `GET /api/v1/llm/models` is the text catalog. They are **not** in sync:
 * the text catalog carries models the general one does not
 * (`gpt-6.1-sol`, `gpt-6.1-terra`), and the general one carries models the
 * text catalog does not.
 *
 * Entries are keyed by model identifier. When both catalogs know a model,
 * the LLM row wins (it is the authoritative text catalog and is richer),
 * and the fields only the AI catalog provides — `settings`, `features`
 * upload constraints, `type` — are merged in.
 */
export function mergeModelCatalogs(aiModels: AIModel[], llmModels: LlmModel[]): AIModel[] {
  const merged = new Map<string, AIModel>();
  for (const model of aiModels) {
    merged.set(model.value, { ...model });
  }
  for (const row of llmModels) {
    const normalized = normalizeLlmModel(row);
    const existing = merged.get(normalized.value);
    if (!existing) {
      merged.set(normalized.value, normalized);
      continue;
    }
    merged.set(normalized.value, {
      ...existing,
      // The LLM catalog is authoritative for text models — including their
      // availability. Three models (`deepseek-r1`, `gemini-3.7-flash`,
      // `grok-4.6`) are enabled upstream for text but flagged inactive in
      // the general catalog, and taking the general row's flag would drop
      // them from the merged list.
      active: normalized.active,
      label: normalized.label,
      description: normalized.description ?? existing.description,
      default: normalized.default || existing.default,
      // Keep the AI catalog's upload/feature metadata — the LLM catalog
      // has no equivalent.
      settings: existing.settings,
      features: existing.features ?? normalized.features,
      llm: normalized.llm,
    });
  }
  return [...merged.values()];
}
