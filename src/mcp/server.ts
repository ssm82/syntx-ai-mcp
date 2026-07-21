import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { createMcpContext, withRequestContext } from './context';
import { allTools } from './tools';
import { allResources, allResourceTemplates } from './resources';
import { allPrompts } from './prompts';
import { toMcpError } from './errors';
import { logSecurityEvent } from './security-log';
import type { McpServerConfig } from '../config';
import type { McpContext, SyntxResourceTemplate, SyntxToolExtra } from './registry';

const SERVER_NAME = 'syntx-ai-mcp';
const SERVER_VERSION = '0.3.0';

/**
 * Build a configured MCP {@link Server} with all syntx-ai-mcp tools,
 * resources, resource templates, and prompts registered.
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
        resources: {},
        prompts: {},
      },
    },
  );

  // ── Tools ─────────────────────────────────────────────────────────────
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

  // ── Resources ─────────────────────────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: allResources.map((r) => ({
      uri: r.uri,
      name: r.name,
      ...(r.description ? { description: r.description } : {}),
      ...(r.mimeType ? { mimeType: r.mimeType } : {}),
    })),
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: allResourceTemplates.map((t) => ({
      uriTemplate: t.uriTemplate,
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      ...(t.mimeType ? { mimeType: t.mimeType } : {}),
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    // 1. Direct static match.
    const staticResource = allResources.find((r) => r.uri === uri);
    if (staticResource) {
      return staticResource.read(context);
    }

    // 2. Try each template.
    for (const template of allResourceTemplates) {
      const params = matchTemplate(template, uri);
      if (params) {
        return template.read(uri, params, context);
      }
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // ── Prompts ───────────────────────────────────────────────────────────
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: allPrompts.map((p) => ({
      name: p.name,
      ...(p.description ? { description: p.description } : {}),
      ...(p.arguments ? { arguments: p.arguments } : {}),
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const prompt = allPrompts.find((p) => p.name === name);
    if (!prompt) {
      throw new Error(`Unknown prompt: ${name}`);
    }
    return prompt.get((args as Record<string, string>) ?? {}, context);
  });

  return { server, context };
}

/**
 * Match a concrete URI against a `{param}`-style template and return the
 * extracted parameters, or `null` if it does not match.
 *
 * ReDoS-hardened (I2, v0.3.0):
 *  - Hard caps on input length (`uri` ≤ 512, `uriTemplate` ≤ 256 chars) so a
 *    pathological URI cannot amplify backtracking even if a future template
 *    introduces nested quantifiers.
 *  - Template literals are regex-escaped before assembly — a metacharacter
 *    in `uriTemplate` can never become an active regex construct.
 *  - Capture groups are the fixed, non-backtracking `([^/]+)` shape.
 */
const MAX_URI_LENGTH = 512;
const MAX_TEMPLATE_LENGTH = 256;

function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Exported for unit testing (I2 regression tests).
export function matchTemplate(template: SyntxResourceTemplate, uri: string): Record<string, string> | null {
  if (uri.length > MAX_URI_LENGTH || template.uriTemplate.length > MAX_TEMPLATE_LENGTH) {
    return null;
  }  const paramNames: string[] = [];
  const regexSource = template.uriTemplate.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    paramNames.push(name);
    return '\x00PARAM\x00';
  });
  const pattern = escapeRegExpLiteral(regexSource).replace(/\x00PARAM\x00/g, '([^/]+)');
  const match = new RegExp(`^${pattern}$`).exec(uri);
  if (!match) return null;
  const params: Record<string, string> = {};
  paramNames.forEach((name, i) => {
    params[name] = decodeURIComponent(match[i + 1]);
  });
  return params;
}
