/**
 * Registry contracts for syntx-ai-mcp.
 *
 * These are framework-agnostic shapes that the tool modules implement.
 * {@link createMcpServer} adapts them onto the official MCP SDK.
 */

import type {
  Tool,
  ContentBlock,
  CallToolResult,
  ServerRequest,
  ServerNotification,
} from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

/**
 * Extra context passed by the MCP server to every tool handler.
 *
 * Mirrors the shape of the underlying {@link RequestHandlerExtra} but exposes
 * just the fields our handlers care about, so tool authors don't need to
 * import MCP SDK internals.
 */
export type SyntxToolExtra = Pick<
  RequestHandlerExtra<ServerRequest, ServerNotification>,
  'sendNotification' | '_meta' | 'signal'
>;

/**
 * A single content block in a tool result. Aliased to the MCP SDK `ContentBlock`
 * union so handler output is structurally identical to what the protocol expects.
 */
export type SyntxToolContent = ContentBlock;

/**
 * Result of a tool handler. Aliased to the native {@link CallToolResult}:
 * handlers return data directly without constructing a full envelope, and the
 * server hands it straight back to the transport.
 */
export type SyntxToolResult = CallToolResult;

/**
 * Capability inventory for a tool (I3, v0.3.0).
 *
 * Declares the security-relevant effects a tool can have so the server can
 * enforce policy generically (e.g. rejecting `localFileRead` arguments over
 * the HTTP transport) and so operators can audit the attack surface without
 * reading every handler. All flags default to `false` when omitted.
 *
 * After the v0.3.0 surface reduction the only enforced capability is
 * `localFileRead` (the I3 path-rejection in `server.ts`). The other flags
 * were documentation-only and have been removed — re-introduce them as
 * `boolean` members here if a future invariant needs the runtime check.
 */
export interface SyntxToolCapability {
  /** Reads files from the MCP server's local filesystem (e.g. `path` input). */
  localFileRead?: boolean;
}

export interface McpContext {
  /** Active SyntxClient. Token can be swapped at runtime via `setToken`. */
  readonly syntx: import('../syntx-client').SyntxClient;
  /**
   * Resolved server configuration (live, read-only snapshot).
   */
  readonly config: Readonly<import('../config').McpServerConfig>;
  /** Replace the active token (propagates to the underlying client). */
  setToken(token: string | undefined): void;
  /**
   * Send a `notifications/progress` frame to the client if it supplied a
   * `progressToken` for this request. No-op when the client opted out.
   *
   * Used by streaming tools to surface intermediate state without blocking
   * the final result.
   */
  sendProgress?: (progress: number, total?: number, message?: string) => Promise<void>;
  /**
   * Send a `notifications/message` (logging) frame to the client. Falls
   * back silently if the client does not support logging notifications.
   *
   * Used by `stream-message` for per-chunk log notifications (see
   * `chats.ts:streamAsk.onChunk`).
   */
  sendLog?: (
    level: 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency',
    data: unknown,
    logger?: string,
  ) => Promise<void>;
}

export interface SyntxTool {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  inputSchema: Tool['inputSchema'];
  /**
   * Security-relevant capability inventory (I3). Used by the server for
   * generic runtime enforcement and by operators for attack-surface audits.
   */
  capability?: SyntxToolCapability;
  /**
   * Tool handler. The optional {@link SyntxToolExtra} carries progress /
   * logging notifications; legacy callers can simply ignore it.
   */
  handler: (
    args: Record<string, unknown>,
    ctx: McpContext,
    extra?: SyntxToolExtra,
  ) => Promise<SyntxToolResult>;
}

export type {
  Tool,
  ContentBlock,
  CallToolResult,
};
