import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';

/**
 * Authentication & identity tools.
 *
 * `set-token` lets an MCP client supply a syntx.ai bearer token at runtime,
 * which is essential for headless servers that are not pre-configured via env.
 */
export const authTools: SyntxTool[] = [
  {
    name: 'whoami',
    description:
      'Return the profile of the currently authenticated syntx.ai user. ' +
      'Use this to verify that a token is valid and see who it belongs to.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async handler(_args, ctx) {
      try {
        const user = await ctx.syntx.user.me();
        return textResult(JSON.stringify(user, null, 2));
      } catch (err) {
        return toMcpError(err, 'whoami');
      }
    },
  },
  {
    name: 'set-token',
    description:
      'Set or replace the syntx.ai bearer token used by the server at runtime. ' +
      'Call this before any authenticated operation if SYNTX_TOKEN was not configured.',
    inputSchema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'A syntx.ai bearer token.',
        },
      },
      required: ['token'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const token = String(args.token ?? '').trim();
      if (!token) return toMcpError(new Error('token must be a non-empty string'), 'set-token');
      ctx.setToken(token);
      return textResult('Token updated. Use "whoami" or "validate-token" to confirm it works.');
    },
  },
  {
    name: 'validate-token',
    description: 'Check whether the currently configured token is accepted by syntx.ai.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async handler(_args, ctx) {
      if (!ctx.syntx.auth.isAuthenticated()) {
        return textResult('No token is currently set.');
      }
      try {
        const ok = await ctx.syntx.auth.validateToken();
        return textResult(ok ? 'Token is valid.' : 'Token was rejected by syntx.ai.');
      } catch (err) {
        return toMcpError(err, 'validate-token');
      }
    },
  },
];
