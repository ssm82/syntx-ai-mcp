#!/usr/bin/env node
/**
 * syntx-mcp — command-line launcher for the syntx-ai-mcp MCP server.
 *
 * Usage:
 *   syntx-mcp                         # stdio transport, config from env
 *   syntx-mcp --transport http --http-port 8080
 *   syntx-mcp --token SYNTX_TOKEN_HERE
 *
 * All flags override environment variables; everything else comes from env.
 */

import { loadConfig } from '../config';
import { createMcpServer } from '../mcp/server';
import { runTransport } from '../transport';

interface ParsedArgs {
  transport?: 'stdio' | 'http';
  token?: string;
  baseURL?: string;
  httpPort?: number;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--help':
      case '-h':
        out.help = true;
        break;
      case '--transport':
        if (next === 'stdio' || next === 'http') {
          out.transport = next;
          i++;
        }
        break;
      case '--token':
        out.token = next;
        i++;
        break;
      case '--base-url':
        out.baseURL = next;
        i++;
        break;
      case '--http-port':
        out.httpPort = Number(next);
        i++;
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(2);
        }
    }
  }
  return out;
}

const HELP = `
syntx-mcp — MCP server for the syntx.ai platform

Options:
  --transport <stdio|http>   MCP transport (default: stdio, or MCP_TRANSPORT env)
  --token <token>            syntx.ai bearer token (default: SYNTX_TOKEN env)
  --base-url <url>           Override the API base URL (default: https://api.syntx.ai)
  --http-port <port>         Port for the HTTP transport (default: 3000)
  -h, --help                 Show this help

Environment variables:
  SYNTX_TOKEN, SYNTX_BASE_URL, SYNTX_TIMEOUT, SYNTX_LANG,
  SYNTX_DEFAULT_AI, SYNTX_DEFAULT_MODEL,
  SYNTX_POLL_INTERVAL, SYNTX_POLL_TIMEOUT,
  MCP_TRANSPORT, MCP_HTTP_PORT, MCP_HTTP_HOSTNAME, MCP_HTTP_TOKEN
`.trim();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    return;
  }

  const config = {
    ...loadConfig(),
    ...(args.transport ? { transport: args.transport } : {}),
    ...(args.token ? { token: args.token } : {}),
    ...(args.baseURL ? { baseURL: args.baseURL } : {}),
    ...(args.httpPort ? { httpPort: args.httpPort } : {}),
  };

  if (!config.token) {
    console.error(
      '[syntx-mcp] No token configured. Set SYNTX_TOKEN or pass --token, ' +
        'or supply one at runtime via the "set-token" tool.',
    );
  }

  // Stateless HTTP builds a fresh server per request; stdio reuses one instance.
  // Both transports source their server(s) from this factory. `requestToken`
  // is the M2 HTTP Authorization-passthrough credential (undefined on stdio).
  const serverFactory = (requestToken?: string) => createMcpServer(config, requestToken).server;

  try {
    await runTransport(serverFactory, config.transport, config.httpPort, {
      hostname: config.httpHostname,
      httpToken: config.httpToken,
    });
  } catch (err) {
    console.error(
      `[syntx-mcp] Failed to start ${config.transport} transport:`,
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }

  if (config.transport === 'http') {
    // L3: bootstrap messages must go to stderr — stdout is reserved for
    // JSON-RPC frames when running under stdio, and we want a single
    // convention across all transports.
    console.error(`[syntx-mcp] HTTP transport listening on http://${config.httpHostname}:${config.httpPort}/mcp`);
    console.error('[syntx-mcp] Health check at /health');
    if (config.httpToken) {
      console.error('[syntx-mcp] Bearer auth enabled (MCP_HTTP_TOKEN).');
    }
  } else {
    console.error('[syntx-mcp] stdio transport ready.');
  }
}

main().catch((err) => {
  console.error('[syntx-mcp] Fatal error:', err);
  process.exit(1);
});
