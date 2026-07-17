import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Run the MCP server over HTTP with SSE streaming, using the canonical
 * **stateless** pattern: a fresh transport (and a fresh server instance)
 * is created per request. This avoids the "server already connected" error
 * and suits remote / serverless MCP clients.
 *
 * @param serverFactory builds a brand-new, connected-ready MCP server per request.
 * @returns a function to stop the HTTP server.
 */
export async function startHttp(
  serverFactory: () => Server,
  port: number,
  hostname = '127.0.0.1',
): Promise<() => Promise<void>> {
  const httpServer = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Health endpoint for liveness probes.
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Stateless: GET/DELETE are not supported.
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed.' },
          id: null,
        }),
      );
      return;
    }

    const server = serverFactory();
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: err instanceof Error ? err.message : 'Internal error',
            },
            id: null,
          }),
        );
      }
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, hostname, resolve));

  return () =>
    new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
}
