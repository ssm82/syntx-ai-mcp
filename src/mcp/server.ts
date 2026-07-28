import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { createMcpContext, withRequestContext } from './context';
import { allTools } from './tools';
import { toMcpError } from './errors';
import { logSecurityEvent } from './security-log';
import type { McpServerConfig } from '../config';
import type { McpContext, SyntxToolExtra } from './registry';

const SERVER_NAME = 'syntx-ai-mcp';
const SERVER_VERSION = '0.3.0';

/**
 * Build a configured MCP {@link Server} with all syntx-ai-mcp tools registered.
 *
 * `requestToken` (M2, v0.3.0) carries an HTTP request-scoped credential
 * (Authorization-header passthrough) — see {@link createMcpContext} for the
 * full token-precedence rules. Omit for stdio / single-tenant deployments.
 *
 * The returned server is NOT yet connected to a transport — call
 * `server.connect(transport)` from the transport layer.
 */
export function createMcpServer(
  config: McpServerConfig,
  requestToken?: string,
): {
  server: Server;
  context: McpContext;
} {
  const context = createMcpContext(config, requestToken);

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const tool = allTools.find((t) => t.name === name);
    if (!tool) {
      return toMcpError(new Error(`Unknown tool: ${name}`), 'call-tool');
    }
    // I3: metadata-driven enforcement — a tool that declares `localFileRead`
    // must never receive a server-side `path` argument over a non-stdio
    // transport, regardless of whether its own handler remembered to check.
    if (
      context.config.transport !== 'stdio' &&
      tool.capability?.localFileRead &&
      typeof (args as Record<string, unknown> | undefined)?.path === 'string'
    ) {
      logSecurityEvent({
        kind: 'upload-files.path.rejected',
        transport: context.config.transport,
        reason: 'capability-localFileRead',
        meta: { tool: name },
      });
      return toMcpError(
        new Error(
          `${name}: \`path\` is not permitted over the ${context.config.transport} transport. ` +
            'Send the payload inline (e.g. `content_base64`) instead.',
        ),
        `tool:${name}`,
      );
    }
    try {
      // Enrich the shared context with progress / log callbacks bound to this
      // request so streaming tools can emit notifications out-of-band.
      const reqCtx = withRequestContext(context, extra as SyntxToolExtra);
      return await tool.handler(
        (args as Record<string, unknown>) ?? {},
        reqCtx,
        extra as SyntxToolExtra,
      );
    } catch (err) {
      return toMcpError(err, `tool:${name}`);
    }
  });

  return { server, context };
}
