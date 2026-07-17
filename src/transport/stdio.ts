import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Connect the MCP server over the stdio transport.
 *
 * stdio is the default and recommended transport for local MCP clients
 * (Claude Desktop, IDE agents): the server runs as a child process and
 * communicates over its standard streams.
 */
export async function startStdio(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
