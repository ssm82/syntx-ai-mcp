import type { SyntxTool } from '../registry';
import { textResult, toMcpError, toolError } from '../errors';

/**
 * Read-only user account tools: profile, balance, subscription.
 *
 * `get-profile` returns the full user profile and raises a clear MCP error
 * when no token is configured. For a non-erroring identity check (that reports
 * `authenticated: false` instead of erroring), use the `whoami` tool.
 */
export const userTools: SyntxTool[] = [
  {
    name: 'get-profile',
    capability: { networkCall: true },
    description:
      'Return the current user profile (sanitised public fields: id, user_id, ' +
      'name, username, email, avatar, auth_services). Internal identifiers such ' +
      'as `chatwoot_hmac` / `ym_client_id` are stripped before returning. ' +
      'Requires authentication — raises a clear error when no token is set. ' +
      'For a non-erroring identity check, use `whoami` which returns ' +
      '{ authenticated, user }.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      if (!ctx.syntx.auth.isAuthenticated()) {
        return toolError(
          'get-profile: Unauthorized. Set your syntx.ai token first via the "set-token" tool ' +
            '(or the SYNTX_TOKEN env variable).',
        );
      }
      try {
        return textResult(JSON.stringify(await ctx.syntx.user.mePublic(), null, 2));
      } catch (err) {
        return toMcpError(err, 'get-profile');
      }
    },
  },
  {
    name: 'get-balance',
    capability: { networkCall: true },
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
    capability: { networkCall: true },
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
