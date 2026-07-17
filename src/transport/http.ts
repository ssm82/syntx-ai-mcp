import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/**
 * Options for the HTTP/SSE transport.
 */
export interface HttpTransportOptions {
  /** Builds a brand-new, connected-ready MCP server per request. */
  serverFactory: () => Server;
  /** TCP port to listen on. */
  port: number;
  /** Bind address. Defaults to loopback (127.0.0.1) for safety. */
  hostname?: string;
  /**
   * Optional bearer token MCP clients must present. When set, requests
   * without a matching `Authorization: Bearer <token>` header are rejected
   * with 401. When unset, the transport is loopback-only and a security
   * warning is printed at startup.
   */
  httpToken?: string;
}

/**
 * Run the MCP server over HTTP with SSE streaming, using the canonical
 * **stateless** pattern: a fresh transport (and a fresh server instance)
 * is created per request. This avoids the "server already connected" error
 * and suits remote / serverless MCP clients.
 *
 * Security (v0.2.0+):
 *  - **Host/Origin allow-list** — always on; rejects DNS-rebinding requests
 *    whose `Host`/`Origin` header is not a loopback/expected host.
 *  - **Bearer auth** — when `httpToken` is set, requests must carry a matching
 *    `Authorization: Bearer <token>` header (timing-safe compare).
 *  - **CORS preflight** — `OPTIONS` is answered 200 without a token check; no
 *    wildcard `Access-Control-Allow-Origin` is ever emitted.
 *
 * @returns a function to stop the HTTP server.
 */
export async function startHttp(opts: HttpTransportOptions): Promise<() => Promise<void>> {
  const { serverFactory, port } = opts;
  const hostname = opts.hostname ?? '127.0.0.1';
  const expectedToken = opts.httpToken?.trim() || undefined;

  // Loopback + the configured bind host. The configured hostname is included
  // so binding to, e.g., an explicit LAN IP still works when the client uses
  // that same host in its Host header.
  const allowedHosts = new Set<string>(['127.0.0.1', 'localhost', '::1', hostname.toLowerCase()]);

  const isLoopbackBind = ['127.0.0.1', 'localhost', '::1'].includes(hostname.toLowerCase());

  // Startup security warnings.
  if (!expectedToken) {
    if (isLoopbackBind) {
      console.warn(
        '[syntx-mcp] WARNING: MCP_HTTP_TOKEN is not set. The HTTP transport is running ' +
          'unauthenticated on loopback. Any local process or website (via loopback / ' +
          'DNS-rebinding) could access it. Set MCP_HTTP_TOKEN for production use. ' +
          'Do not run in untrusted environments.',
      );
    } else {
      console.error(
        '[syntx-mcp] DANGER: HTTP transport is bound to a non-loopback address (' +
          hostname + ') without MCP_HTTP_TOKEN. Set MCP_HTTP_TOKEN before exposing ' +
          'the server, or bind to 127.0.0.1.',
      );
    }
  } else if (!isLoopbackBind) {
    console.warn(
      '[syntx-mcp] HTTP transport bound to non-loopback address (' + hostname +
        ') — ensure MCP_HTTP_TOKEN and a network firewall are in place.',
    );
  }

  const httpServer = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Health endpoint for liveness probes (no auth, no host gate).
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // CORS preflight — answer without auth so browser clients can negotiate.
    // No Access-Control-Allow-Origin is emitted by default; MCP clients are
    // not browsers. Add CORS headers only via an explicit reverse proxy.
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Host/Origin allow-list gate (DNS-rebinding defense). Always on.
    const hostOk = checkHostHeader(req.headers.host, allowedHosts);
    const originOk = checkHostHeader(req.headers.origin, allowedHosts, true);
    if (!hostOk || !originOk) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Forbidden: Host/Origin not allowed.' },
          id: null,
        }),
      );
      return;
    }

    // Stateless: only POST is supported for MCP.
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

    // Bearer auth (when configured).
    if (expectedToken && !isAuthorized(req.headers.authorization, expectedToken)) {
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized: missing or invalid bearer token.' },
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

/**
 * Extract the hostname component from a `Host`/`Origin` header value and
 * test it against the allow-list. Lowercases, strips the port, and unwraps
 * IPv6 brackets. `undefined`/absent → treated as allowed only when `optional`
 * (Origin is optional; Host is required upstream).
 */
function checkHostHeader(
  headerValue: string | string[] | undefined,
  allowed: Set<string>,
  optional = false,
): boolean {
  if (headerValue === undefined) return optional;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) return optional;

  // Origin may include a scheme: strip it.
  let host = raw.trim().toLowerCase();
  const schemeMatch = host.match(/^[a-z]+:\/\/([^/:]+)/);
  if (schemeMatch) host = schemeMatch[1];

  // Unwrap IPv6 brackets ([::1]) and strip :port.
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    host = end !== -1 ? host.slice(1, end) : host;
  } else {
    const colon = host.indexOf(':');
    if (colon !== -1) host = host.slice(0, colon);
  }
  return allowed.has(host);
}

/**
 * Constant-time comparison of the provided `Authorization` header against the
 * expected bearer token. Returns true only when the scheme is Bearer (case-
 * insensitive) and the token matches. Length differences do not short-circuit.
 */
function isAuthorized(headerValue: string | string[] | undefined, expected: string): boolean {
  if (!headerValue) return false;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) return false;

  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 2) return false;
  if (parts[0].toLowerCase() !== 'bearer') return false;

  const provided = Buffer.from(parts[1]);
  const expectedBuf = Buffer.from(expected);

  if (provided.length !== expectedBuf.length) {
    // Compare anyway to avoid leaking length, then reject.
    timingSafeEqual(provided, provided);
    return false;
  }
  return timingSafeEqual(provided, expectedBuf);
}
