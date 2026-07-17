import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';

/** Read-only user account tools: profile, balance, subscription. */
export const userTools: SyntxTool[] = [
  {
    name: 'get-profile',
    description: 'Return the current user profile (name, email, avatar, auth services).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      try {
        return textResult(JSON.stringify(await ctx.syntx.user.me(), null, 2));
      } catch (err) {
        return toMcpError(err, 'get-profile');
      }
    },
  },
  {
    name: 'get-balance',
    description: 'Return the current token balance for the authenticated user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      try {
        return textResult(JSON.stringify(await ctx.syntx.user.getBalance(), null, 2));
      } catch (err) {
        return toMcpError(err, 'get-balance');
      }
    },
  },
  {
    name: 'get-subscription',
    description: 'Return the active subscription and referral information for the user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      try {
        return textResult(JSON.stringify(await ctx.syntx.user.getSubscription(), null, 2));
      } catch (err) {
        return toMcpError(err, 'get-subscription');
      }
    },
  },
];
