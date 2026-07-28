import type { SyntxTool, SyntxToolResult } from '../registry';
import { textResult, toMcpError, toolError } from '../errors';
import { SyntxAuthError } from '../../errors';
import { logSecurityEvent } from '../security-log';
import type { McpContext } from '../registry';

/**
 * Security invariant (H4): an HTTP request must not mutate authentication
 * state shared with other HTTP clients. The shared mutable `SyntxClient`
 * singleton (M2) is a transitional state — until 0.3.0 introduces per-request
 * token scoping, we hard-block token-mutating tools when running over HTTP.
 *
 * `stdio` clients own the process and are permitted to install tokens at
 * runtime; `http` clients must come pre-configured (via `SYNTX_TOKEN` env).
 *
 * Returns an MCP error result when the transport is not permitted, or
 * `null` when the call may proceed. Handlers must propagate the result:
 *
 *   const blocked = assertLocalAuthMutationAllowed(ctx, 'set-token');
 *   if (blocked) return blocked;
 */
function assertLocalAuthMutationAllowed(ctx: McpContext, op: string): SyntxToolResult | null {
  if (ctx.config.transport !== 'stdio') {
    logSecurityEvent({
      kind: 'auth-mutation.rejected',
      transport: ctx.config.transport,
      reason: op,
      meta: { tool: op },
    });
    return toolError(
      `${op}: not permitted over the ${ctx.config.transport} transport. ` +
        'Authentication state is process-global; configure the bearer via the SYNTX_TOKEN ' +
        'environment variable before starting the server.',
    );
  }
  return null;
}

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
      '{ authenticated, user } where `user` is a sanitised public profile ' +
      '(id, user_id, name, username, email, avatar, auth_services). Internal ' +
      'identifiers such as `chatwoot_hmac` / `ym_client_id` are intentionally ' +
      'stripped. This tool NEVER errors on missing/invalid tokens — ' +
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
        const user = await ctx.syntx.user.mePublic();
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
      'when the process restarts. ' +
      '**stdio only**: this tool is rejected over the HTTP transport to prevent ' +
      'a remote client from hijacking the process-shared bearer (H4). Configure ' +
      'the token via the SYNTX_TOKEN env variable when running with --transport http.',
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
      const blocked = assertLocalAuthMutationAllowed(ctx, 'set-token');
      if (blocked) return blocked;
      const token = String(args.token ?? '').trim();
      if (!token) return toMcpError(new Error('token must be a non-empty string'), 'set-token');
      ctx.setToken(token);
      return textResult('Token updated. Use "whoami" or "validate-token" to confirm it works.');
    },
  },
];
