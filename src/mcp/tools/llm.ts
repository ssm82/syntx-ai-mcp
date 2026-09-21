import type { SyntxTool } from '../registry';
import { wrapSdk } from './_helpers';
import type { LlmLimits } from '../../types';

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
      'A window with expired or null expires_at is normalized to {percent_left: 100, started_at: null, expires_at: null}.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: wrapSdk<Record<string, never>, LlmLimits>(
      'get-llm-limits',
      async (_args, ctx) => ctx.syntx.llm.getLimits(),
    ),
  },
];
