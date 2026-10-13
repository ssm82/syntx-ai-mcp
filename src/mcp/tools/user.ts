import type { SyntxTool } from '../registry';
import { textResult, toMcpError, toolError } from '../errors';
import { wrapSdk } from './_helpers';

/**
 * Read-only user account tools: profile, balance.
 *
 * `get-profile` returns the full user profile and raises a clear MCP error
 * when no token is configured. For a non-erroring identity check (that reports
 * `authenticated: false` instead of erroring), use the `whoami` tool.
 */
export const userTools: SyntxTool[] = [
  {
    name: 'get-profile',
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
    description: 'Return the current token balance for the authenticated user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: wrapSdk('get-balance', async (_args, ctx) => ctx.syntx.user.getBalance()),
  },
  {
    name: 'get-tokens-history',
    description:
      'Cursor-paginated token-spend history. Wraps `syntx.user.getTokensHistory`. ' +
      'Hits `GET /api/v1/user/tokens/history`. Pass the previous page\'s ' +
      '`next_cursor` (if non-null) to walk forward; `null` means the last page.',
    inputSchema: {
      type: 'object',
      properties: {
        cursor: { type: 'string', description: 'Cursor from the previous page. Omit on the first call.' },
        page_size: { type: 'number', minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    handler: wrapSdk<{ cursor?: string; page_size?: number }, unknown>(
      'get-tokens-history',
      async (args, ctx) =>
        ctx.syntx.user.getTokensHistory({
          cursor: args.cursor,
          page_size: args.page_size ?? 20,
        }),
    ),
  },
];
