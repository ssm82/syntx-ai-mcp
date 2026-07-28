import type { McpContext, SyntxToolResult } from '../registry';
import { textResult, toMcpError } from '../errors';

/**
 * Wrap an SDK call into the standard MCP handler shape:
 *   try { result = await fn(args, ctx); return textResult(JSON.stringify(result, null, 2)); }
 *   catch (err) { return toMcpError(err, `tool:${name}`); }
 *
 * Recovery hint for `SyntxTimeoutError.chatId` is preserved because `toMcpError`
 * already extracts it (see `errors.ts`). Safe only for tools that return a single
 * JSON-serialisable payload; do NOT use for streaming or media tools.
 *
 * `<TArgs>` MUST be supplied explicitly at the call-site — otherwise TypeScript
 * widens the inferred arg type to `Record<string, unknown>` (which is fine for
 * the runtime but loses per-tool arg typing for IDE assistance).
 */
export function wrapSdk<TArgs = Record<string, unknown>, TResult = unknown>(
  name: string,
  fn: (args: TArgs, ctx: McpContext) => Promise<TResult>,
): (args: Record<string, unknown>, ctx: McpContext) => Promise<SyntxToolResult> {
  return async (args, ctx) => {
    try {
      const result = await fn(args as TArgs, ctx);
      return textResult(JSON.stringify(result, null, 2));
    } catch (err) {
      return toMcpError(err, `tool:${name}`);
    }
  };
}
