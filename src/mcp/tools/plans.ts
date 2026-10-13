import type { SyntxTool } from '../registry';
import { wrapSdk } from './_helpers';

/**
 * Plans & pricing tools.
 */
export const plansTools: SyntxTool[] = [
  {
    name: 'list-tariffs',
    description:
      'List plan tariffs (the actual price list). Wraps `syntx.plans.listTariffs`. ' +
      'Hits `GET /api/v1/plans/tariffs?period=monthly|annual`. The server 422s on ' +
      'any other `period` value, so the enum is pinned in the schema.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['monthly', 'annual'],
          default: 'monthly',
          description: 'Tariff period. Defaults to "monthly" (matches the web client).',
        },
      },
      additionalProperties: false,
    },
    handler: wrapSdk<{ period?: 'monthly' | 'annual' }, unknown>(
      'list-tariffs',
      async (args, ctx) => ctx.syntx.plans.listTariffs(args.period ?? 'monthly'),
    ),
  },
];
