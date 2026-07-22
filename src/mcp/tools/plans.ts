import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';

/**
 * Plans and promo banner tools.
 *
 * These mirror the `syntx.plans.list` / `syntx.plans.getPromoBanners` SDK
 * methods. The underlying endpoints are `GET /api/v1/plans/card_plans` and
 * `GET /api/v1/promo_banners`.
 */
export const plansTools: SyntxTool[] = [
  {
    name: 'list-plans',
    capability: { networkCall: true },
    description:
      'Return all available subscription plans with detailed descriptions. ' +
      'Mirrors `syntx.plans.list`. Hits `GET /api/v1/plans/card_plans`.',
    inputSchema: {
      type: 'object',
      properties: {
        lang: {
          type: 'string',
          default: 'en',
          description: 'Language code for localised plan descriptions. Defaults to "en".',
        },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const lang = args.lang === undefined ? 'en' : String(args.lang);
      try {
        const plans = await ctx.syntx.plans.list(lang);
        return textResult(JSON.stringify(plans, null, 2));
      } catch (err) {
        return toMcpError(err, 'list-plans');
      }
    },
  },
  {
    name: 'list-promo-banners',
    capability: { networkCall: true },
    description:
      'Return promo banners for a given language. Mirrors `syntx.plans.getPromoBanners`. ' +
      'Hits `GET /api/v1/promo_banners`.',
    inputSchema: {
      type: 'object',
      properties: {
        lang: {
          type: 'string',
          description: 'Language code for localised banners. Optional; omit to use the server default.',
        },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const lang = args.lang === undefined ? undefined : String(args.lang);
      try {
        const banners = await ctx.syntx.plans.getPromoBanners(lang);
        return textResult(JSON.stringify(banners, null, 2));
      } catch (err) {
        return toMcpError(err, 'list-promo-banners');
      }
    },
  },
];