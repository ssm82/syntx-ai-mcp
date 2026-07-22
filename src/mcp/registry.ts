/**
 * Registry contracts for syntx-ai-mcp.
 *
 * These are framework-agnostic shapes that the tool/resource/prompt modules
 * implement. {@link createMcpServer} adapts them onto the official MCP SDK.
 */

import type {
  Tool,
  Prompt,
  ContentBlock,
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
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
 */
export interface SyntxToolCapability {
  /** Reads files from the MCP server's local filesystem (e.g. `path` input). */
  localFileRead?: boolean;
  /** Mutates authentication state (installs/replaces the bearer token). */
  authMutation?: boolean;
  /** Sends local/user-supplied content to an external service. */
  externalExfiltration?: boolean;
  /** Performs an outbound network call. */
  networkCall?: boolean;
  /** Incurs a billable side effect (token spend, email/SMS delivery, …). */
  costSideEffect?: boolean;
}

export interface McpContext {
  /** Active SyntxClient. Token can be swapped at runtime via `setToken`. */
  readonly syntx: import('../syntx-client').SyntxClient;
  /**
   * Resolved server configuration (live, read-only snapshot).
   *
   * The underlying store is mutable via the `setDefaultModel` / `setDefaultAI`
   * mutators below, so consumers must treat the returned reference as a
   * snapshot of the *current* effective values — re-reading it on each
   * call site is the safe pattern.
   */
  readonly config: Readonly<import('../config').McpServerConfig>;
  /** Replace the active token (propagates to the underlying client). */
  setToken(token: string | undefined): void;
  /**
   * Install a new default model at runtime.
   *
   * Pass `null` to clear `defaultModel` (falling back to whatever the tool
   * caller specified). Subsequent tool invocations that read `ctx.config.defaultModel`
   * will see the updated value.
   */
  setDefaultModel(model: string | null): void;
  /**
   * Switch the default AI provider at runtime (e.g. `"chatgpt"`, `"claude"`,
   * `"midjourney"`). Affects subsequent tool invocations that fall back to
   * `ctx.config.defaultAI` when the caller omits `ai_name`.
   */
  setDefaultAI(ai: string): void;
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

export interface SyntxResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  /** Produce the resource body. May throw; the server maps errors to MCP errors. */
  read: (ctx: McpContext) => Promise<ReadResourceResult>;
}

export interface SyntxResourceTemplate {
  /** Template URI with `{param}` placeholders, e.g. `syntx://chat/{uuid}/messages`. */
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
  /** Resolve a filled URI (with concrete param values) into a resource body. */
  read: (uri: string, params: Record<string, string>, ctx: McpContext) => Promise<ReadResourceResult>;
}

export interface SyntxPrompt {
  name: string;
  description?: string;
  arguments?: Prompt['arguments'];
  /** Render the prompt into MCP prompt messages. */
  get: (args: Record<string, string>, ctx: McpContext) => Promise<GetPromptResult>;
}

/** Convenience: the set of capabilities advertised by the server. */
export interface ServerCapabilities {
  tools: boolean;
  resources: boolean;
  resourceTemplates: boolean;
  prompts: boolean;
}

export type {
  Tool,
  Prompt,
  ContentBlock,
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
};
