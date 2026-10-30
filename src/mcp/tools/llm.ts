import type { SyntxTool } from '../registry';
import { wrapSdk } from './_helpers';
import type { LlmLimits, LlmResetPrice } from '../../types';

/**
 * Text-flow LLM tools (read-only surface exposed so far).
 *
 * Generation / streaming tools are wired in the `ask` / `stream-message` /
 * `send-message` / `wait-for-response` retrofit in `chats.ts`; this module
 * keeps the read-only helpers colocated for discoverability.
 */
export const llmTools: SyntxTool[] = [
  {
    name: 'get-llm-limits',
    description:
      'Return the current LLM usage limits (6h and 7d windows). ' +
      'Each window reports percent_left (0..100), started_at, expires_at. ' +
      'A window with expired or null expires_at is normalized to {percent_left: 100, started_at: null, expires_at: null}. ' +
      'Also returns the subscription `plan` the limits belong to.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: wrapSdk<Record<string, never>, LlmLimits>(
      'get-llm-limits',
      async (_args, ctx) => ctx.syntx.llm.getLimits(),
    ),
  },
  {
    name: 'get-llm-reset-price',
    description:
      'Quote the cost of resetting the LLM usage windows. ' +
      'Mirrors `syntx.llm.getResetPrice`. Hits `GET /api/v1/llm/limits/reset/price`. ' +
      'Each window reports available (bool), price_tokens (null when not resettable), ' +
      'used_percent and reason. Read-only — it does not purchase the reset.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: wrapSdk<Record<string, never>, LlmResetPrice>(
      'get-llm-reset-price',
      async (_args, ctx) => ctx.syntx.llm.getResetPrice(),
    ),
  },
];
