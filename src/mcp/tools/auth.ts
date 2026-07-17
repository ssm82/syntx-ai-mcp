import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';
import { SyntxAuthError } from '../../errors';

/**
 * Authentication & identity tools.
 *
 * `whoami` is an identity *check*: it returns an `{ authenticated, user }`
 * shape and NEVER surfaces an MCP error purely because authentication is
 * missing/invalid (401/403) — it simply reports `authenticated: false`.
 * Real failures (network, 5xx) still surface as MCP errors so callers can
 * distinguish "not logged in" from "API unreachable".
 *
 * Contrast with `get-profile` (user.ts), which returns the full profile and
 * raises a clear MCP error when unauthorized. The two tools now differ by
 * *error semantics*, not by field set: both resolve from the same
 * `user.me()` call, so neither trims fields.
 *
 * `set-token` lets an MCP client supply a syntx.ai bearer token at runtime,
 * which is essential for headless servers that are not pre-configured via env.
 */
export const authTools: SyntxTool[] = [
  {
    name: 'whoami',
    description:
      'Return an identity check for the current syntx.ai user: ' +
      '{ authenticated, user } where `user` is the full profile (same fields ' +
      'as get-profile). This tool NEVER errors on missing/invalid tokens — ' +
      'it returns { authenticated: false } instead. Use it to verify ' +
      'authentication status. Real failures (network/API errors) still raise ' +
      'an MCP error so you can tell "not logged in" from "API unreachable".',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async handler(_args, ctx) {
      // No token configured locally → no network call needed.
      if (!ctx.syntx.auth.isAuthenticated()) {
        return textResult(JSON.stringify({ authenticated: false, user: null }, null, 2));
      }
      try {
        const user = await ctx.syntx.user.me();
        return textResult(JSON.stringify({ authenticated: true, user }, null, 2));
      } catch (err) {
        // Auth errors (401/403) → report not-authenticated, not an MCP error.
        if (err instanceof SyntxAuthError) {
          return textResult(JSON.stringify({ authenticated: false, user: null }, null, 2));
        }
        // Any other failure (network, 5xx, malformed response) → real error.
        return toMcpError(err, 'whoami');
      }
    },
  },
  {
    name: 'set-token',
    description:
      'Set or replace the syntx.ai bearer token used by the server at runtime. ' +
      'Call this before any authenticated operation if SYNTX_TOKEN was not configured. ' +
      'The token is held in memory only — it is not persisted to disk and is lost ' +
      'when the process restarts. Over the stateless HTTP transport the token applies ' +
      'to the whole process, so HTTP is intended for single-user loopback use only.',
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
