import { SyntxClient } from '../syntx-client';
import { SyntxAuthError } from '../errors';
import type { McpServerConfig } from '../config';
import type { McpContext, SyntxToolExtra } from './registry';

/**
 * Build the shared {@link McpContext} for a server instance.
 *
 * Token precedence (M2, v0.3.0):
 *   1. `requestToken` — HTTP request `Authorization`-header scope
 *      (multi-tenant / credential-passthrough mode). When present the
 *      credential is immutable for the lifetime of the context: `setToken`
 *      throws, so no request can ever overwrite another tenant's token.
 *   2. Runtime `set-token` — stdio only (H4 invariant blocks it over HTTP).
 *   3. `config.token` (env `SYNTX_TOKEN`) — startup-immutable fallback.
 *
 * The context owns the {@link SyntxClient} used by every tool/resource.
 * Over the stateless HTTP transport a fresh context is built per request,
 * so a request-scoped token never leaks across connections.
 *
 * `config` is a *live, mutable* object internally, but the public field is
 * typed `Readonly<McpServerConfig>` — callers should always go through the
 * provided mutators (`setDefaultModel`, `setDefaultAI`) rather than mutating
 * the object directly.
 */
export function createMcpContext(config: McpServerConfig, requestToken?: string): McpContext {
  const syntx = new SyntxClient({
    token: requestToken ?? config.token,
    baseURL: config.baseURL,
    timeout: config.timeout,
  });

  return {
    syntx,
    config,
    setToken(token) {
      if (requestToken !== undefined) {
        throw new SyntxAuthError(
          'This context carries a request-scoped credential (HTTP Authorization ' +
            'passthrough) and cannot be mutated. Retry with a different ' +
            'Authorization header instead.',
        );
      }
      syntx.auth.setToken(token ?? '');
    },
    setDefaultModel(model) {
      // Mutating the live object: downstream tools reading `ctx.config.defaultModel`
      // pick up the new value on their next invocation.
      (config as { defaultModel?: string }).defaultModel = model ?? undefined;
    },
    setDefaultAI(ai) {
      (config as { defaultAI: string }).defaultAI = ai;
    },
    // sendProgress / sendLog are wired per-request by `createMcpServer` via
    // the request extra — see `mcp/server.ts`. They are declared as optional
    // so direct programmatic use of the context still works.
  };
}

/**
 * Return a shallow-cloned context enriched with `sendProgress` / `sendLog`
 * bound to the current MCP request extra. Tool handlers receive the cloned
 * context via the second argument.
 *
 * Progress notifications are no-ops when the client did not supply a
 * `progressToken` in the request `_meta`.
 */
export function withRequestContext(
  base: McpContext,
  extra: SyntxToolExtra | undefined,
): McpContext {
  if (!extra) return base;

  // The MCP spec lets clients opt into progress tracking by including a
  // `progressToken` in the request `_meta`. We capture it once and reuse it
  // for every subsequent notification.
  const progressToken = (extra._meta as { progressToken?: string | number } | undefined)
    ?.progressToken;

  const sendProgress: McpContext['sendProgress'] = async (progress, total, message) => {
    if (progressToken === undefined || !extra.sendNotification) return;
    try {
      await extra.sendNotification({
        method: 'notifications/progress',
        params: {
          progressToken,
          progress,
          ...(total !== undefined ? { total } : {}),
          ...(message !== undefined ? { message } : {}),
        },
      });
    } catch {
      // The client may not support progress notifications, or the transport
      // may have torn down mid-stream. Progress is best-effort — never let
      // it abort the actual tool handler.
    }
  };

  const sendLog: McpContext['sendLog'] = async (level, data, logger) => {
    if (!extra.sendNotification) return;
    try {
      await extra.sendNotification({
        method: 'notifications/message',
        params: { level, data, logger },
      });
    } catch {
      // Logging is best-effort: some clients don't negotiate the logging
      // capability and the SDK throws. Swallow so streaming/tools keep working.
    }
  };

  return { ...base, sendProgress, sendLog };
}

export { SyntxClient };
