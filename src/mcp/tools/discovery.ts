import type { SyntxTool } from '../registry';
import { wrapSdk } from './_helpers';

/**
 * Discovery and event-feed tools.
 */
export const discoveryTools: SyntxTool[] = [
  {
    name: 'list-trend-categories',
    description:
      'List top-level feed categories used by the home feed. Wraps `syntx.trends.categories`. ' +
      'Hits `GET /api/v1/trends/categories`. Returns `{categories: [{slug, name}]}`.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: wrapSdk('list-trend-categories', async (_args, ctx) => ctx.syntx.trends.categories()),
  },
  {
    name: 'list-trend-tags',
    description:
      'List free-form tags used by the home feed. Wraps `syntx.trends.tags`. ' +
      'Hits `GET /api/v1/trends/tags`. Returns `{tags: [{name}]}`. ' +
      'Note: the live response is often empty.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: wrapSdk('list-trend-tags', async (_args, ctx) => ctx.syntx.trends.tags()),
  },
  {
    name: 'list-events',
    description:
      'Event feed (promotions, milestones, etc.). Wraps `syntx.events.list`. ' +
      'Hits `GET /api/v1/events?page=N`. Returns `{items, total, page, page_size}`.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number', minimum: 1, default: 1 },
        page_size: { type: 'number', minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    handler: wrapSdk<{ page?: number; page_size?: number }, unknown>(
      'list-events',
      async (args, ctx) => ctx.syntx.events.list(args.page ?? 1, args.page_size ?? 20),
    ),
  },
  {
    name: 'list-token-pricing',
    description:
      'Per-model token cost table. Wraps `syntx.tokensPricing.list`. ' +
      'Hits `GET /api/v1/tokens/pricing`. Returns `{items: [{id, cost}]}`.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: wrapSdk('list-token-pricing', async (_args, ctx) => ctx.syntx.tokensPricing.list()),
  },
];
