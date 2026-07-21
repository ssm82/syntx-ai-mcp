import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { logSecurityEvent } from '../mcp/security-log';

/**
 * Options for the HTTP/SSE transport.
 */
export interface HttpTransportOptions {
  /**
   * Builds a brand-new, connected-ready MCP server per request.
   *
   * `requestToken` (M2, v0.3.0) is the bearer credential extracted from the
   * request's own `Authorization` header — only present when the transport-
   * level `httpToken` gate is NOT configured (credential-passthrough mode).
   * When `httpToken` IS configured, the header authenticates the transport
   * gate and is never forwarded to the MCP layer.
   */
  serverFactory: (requestToken?: string) => Server;
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
  /**
   * Hard limit on the request body in bytes. Default 1 MB; configurable via
   * `MCP_HTTP_MAX_BODY_BYTES`; absolute hard cap is 100 MB to keep the
   * server immune from OOM-DoS via giant payloads (M1).
   */
  maxBodyBytes?: number;
  /**
   * Maximum concurrent standalone SSE (GET) streams. Default 100;
   * configurable via `MCP_HTTP_MAX_SSE_CLIENTS`. Excess connections are
   * rejected with 429 before any server work happens (M6).
   */
  maxSseClients?: number;
  /**
   * Idle timeout (ms) for standalone SSE streams: a stream with no bytes
   * written for this long is torn down. Default 60 000; configurable via
   * `MCP_HTTP_SSE_IDLE_TIMEOUT_MS`; `0` disables the idle reaper (M6).
   */
  sseIdleTimeoutMs?: number;
}

// Limits & defaults (M1).
const DEFAULT_MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB
const ABSOLUTE_MAX_BODY_BYTES = 100 * 1024 * 1024; // 100 MB

// SSE limits & defaults (M6).
const DEFAULT_MAX_SSE_CLIENTS = 100;
const DEFAULT_SSE_IDLE_TIMEOUT_MS = 60_000;

function resolveMaxBodyBytes(): number {
  const raw = process.env.MCP_HTTP_MAX_BODY_BYTES;
  if (!raw) return DEFAULT_MAX_BODY_BYTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_BODY_BYTES;
  return Math.min(n, ABSOLUTE_MAX_BODY_BYTES);
}

function resolveMaxSseClients(): number {
  const raw = process.env.MCP_HTTP_MAX_SSE_CLIENTS;
  if (!raw) return DEFAULT_MAX_SSE_CLIENTS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_SSE_CLIENTS;
  return Math.floor(n);
}

function resolveSseIdleTimeoutMs(): number {
  const raw = process.env.MCP_HTTP_SSE_IDLE_TIMEOUT_MS;
  if (!raw) return DEFAULT_SSE_IDLE_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SSE_IDLE_TIMEOUT_MS;
  return Math.floor(n);
}

/**
 * Run the MCP server over HTTP with SSE streaming, using the canonical
 * **stateless** pattern: a fresh transport (and a fresh server instance)
 * is created per request. This avoids the "server already connected" error
 * and suits remote / serverless MCP clients.
 *
 * Security (v0.2.1+):
 *  - **Host/Origin allow-list** — always on; rejects DNS-rebinding requests
 *    whose `Host`/`Origin` header is not a loopback/expected host.
 *  - **Bearer auth** — when `httpToken` is set, requests must carry a matching
 *    `Authorization: Bearer <token>` header (timing-safe compare).
 *  - **CORS preflight** — `OPTIONS` is answered 200 without a token check; no
 *    wildcard `Access-Control-Allow-Origin` is ever emitted.
 *  - **Method allow-list** — only `POST`, `OPTIONS`, and (for SSE) `GET`
 *    against the MCP endpoint are accepted. `HEAD`/`TRACE`/`PUT`/`DELETE`
 *    return 405. The MCP spec uses GET for the standalone SSE stream; we
 *    permit it but require `Accept: text/event-stream` and a zero-length
 *    body. (L1 + L2)
 *  - **Body size limit** — `MCP_HTTP_MAX_BODY_BYTES` (default 1 MB,
 *    hard-capped at 100 MB) prevents OOM DoS. (M1)
 *  - **Content-Encoding** — `gzip`/`br` are rejected; MCP JSON payloads do
 *    not require compression and decoding a multi-GB compressed stream
 *    would defeat the body limit. (M1)
 *  - **Adversarial Host/Origin** — `checkHostHeader` normalises case,
 *    rejects IDN/Unicode, IPv4-mapped IPv6, trailing dots, and embedded
 *    `Host` lists; `X-Forwarded-*` headers are ignored by default. (L4)
 *
 * @returns a function to stop the HTTP server.
 */
export async function startHttp(opts: HttpTransportOptions): Promise<() => Promise<void>> {
  const { serverFactory, port } = opts;
  const hostname = opts.hostname ?? '127.0.0.1';
  const expectedToken = opts.httpToken?.trim() || undefined;
  const maxBodyBytes = opts.maxBodyBytes ?? resolveMaxBodyBytes();
  const maxSseClients = opts.maxSseClients ?? resolveMaxSseClients();
  const sseIdleTimeoutMs = opts.sseIdleTimeoutMs ?? resolveSseIdleTimeoutMs();

  // M6: standalone SSE (GET) connection bookkeeping. The stateless
  // StreamableHTTPServerTransport writes events straight onto the socket —
  // there is no server-side per-client event queue to bound, so the
  // `perClientQueueMax` limit from the audit is enforced implicitly by TCP
  // backpressure; what we CAN and do bound here is the connection count and
  // the idle lifetime of each stream.
  let activeSseClients = 0;

  // Loopback + the configured bind host. The configured hostname is included
  // so binding to, e.g., an explicit LAN IP still works when the client uses
  // that same host in its Host header. Entries are post-normalisation: the
  // check below unwraps IPv6 brackets before comparing.
  const allowedHosts = new Set<string>([
    '127.0.0.1',
    'localhost',
    '::1',
    hostname.toLowerCase(),
  ]);

  const isLoopbackBind = ['127.0.0.1', 'localhost', '::1'].includes(hostname.toLowerCase());

  // Startup security warnings.
  if (!expectedToken) {
    if (isLoopbackBind) {
      console.error(
        '[syntx-mcp] WARNING: MCP_HTTP_TOKEN is not set. The HTTP transport is running ' +
          'unauthenticated on loopback. Any local process or website (via loopback / ' +
          'DNS-rebinding) could access it. Set MCP_HTTP_TOKEN for production use. ' +
          'Do not run in untrusted environments.',
      );
    } else {
      // M5 (v0.3.0): hard fail — refusing to expose an unauthenticated MCP
      // server on a routable interface. Previously this was a warning.
      throw new Error(
        '[syntx-mcp] Refusing to start: HTTP transport is bound to a non-loopback ' +
          `address (${hostname}) without MCP_HTTP_TOKEN. Set MCP_HTTP_TOKEN before ` +
          'exposing the server, or bind to 127.0.0.1.',
      );
    }
  } else if (!isLoopbackBind) {
    console.error(
      '[syntx-mcp] HTTP transport bound to non-loopback address (' + hostname +
        ') — ensure MCP_HTTP_TOKEN and a network firewall are in place.',
    );
  }

  const httpServer = http.createServer(
    {
      // Keep header sizes bounded so a single huge header line can't OOM
      // the parser before our handler runs.
      maxHeaderSize: 16 * 1024,
      // Per-socket timeouts: a slow loris client cannot pin a worker
      // indefinitely.
      requestTimeout: 30_000,
      headersTimeout: 10_000,
    },
    async (req: IncomingMessage, res: ServerResponse) => {
      const clientAddr = req.socket.remoteAddress ?? 'unknown';

      // Health endpoint for liveness probes (no auth, no host gate).
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

      // L1: Host/Origin allow-list gate BEFORE everything (including
      // OPTIONS preflight). This closes the DNS-rebinding window where a
      // malicious page could persuade the browser to issue an OPTIONS
      // probe against an attacker-controlled host.
      const hostOk = checkHostHeader(req.headers.host, allowedHosts);
      const originOk = checkHostHeader(req.headers.origin, allowedHosts, true);
      if (!hostOk || !originOk) {
        logSecurityEvent({
          kind: 'transport.host.rejected',
          transport: 'http',
          clientAddr,
          reason: !hostOk ? 'host-not-allowed' : 'origin-not-allowed',
        });
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

      // CORS preflight — only after Host/Origin gate. We never emit
      // `Access-Control-Allow-Origin: *`; the preflight response is a
      // bare 200 with no body so well-behaved browser clients can move on.
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // L2: Method allow-list. POST for JSON-RPC, GET only when the
      // client explicitly opts into SSE (Accept: text/event-stream).
      // DELETE / HEAD / TRACE / PUT are rejected — the stateless
      // StreamableHTTPServerTransport does not need them, and we don't
      // want to advertise unused attack surface.
      if (req.method === 'POST') {
        // fall through to body-size and auth checks below
      } else if (req.method === 'GET') {
        const accept = (req.headers.accept ?? '').toString();
        if (!accept.includes('text/event-stream')) {
          logSecurityEvent({
            kind: 'transport.method.rejected',
            transport: 'http',
            clientAddr,
            reason: 'get-without-sse-accept',
            meta: { method: 'GET' },
          });
          res.writeHead(405, {
            'content-type': 'application/json',
            allow: 'POST, OPTIONS, GET',
          });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Method not allowed.' },
              id: null,
            }),
          );
          return;
        }
      } else {
        logSecurityEvent({
          kind: 'transport.method.rejected',
          transport: 'http',
          clientAddr,
          reason: 'method-not-allowed',
          meta: { method: req.method ?? 'unknown' },
        });
        res.writeHead(405, {
          'content-type': 'application/json',
          allow: 'POST, OPTIONS, GET',
        });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed.' },
            id: null,
          }),
        );
        return;
      }

      // M2: request-scoped credential passthrough. Only when the transport-
      // level bearer gate is NOT configured — otherwise the Authorization
      // header belongs to the gate and must not leak into the MCP layer.
      const requestToken = expectedToken
        ? undefined
        : extractBearerToken(req.headers.authorization);

      // GET (SSE) — body must be empty. 400 (not 411: the length *is*
      // present, it's just non-zero, which SSE forbids).
      if (req.method === 'GET') {
        const cl = Number(req.headers['content-length'] ?? '0');
        if (!Number.isFinite(cl) || cl !== 0) {
          logSecurityEvent({
            kind: 'transport.method.rejected',
            transport: 'http',
            clientAddr,
            reason: 'get-with-body',
            meta: { method: 'GET' },
          });
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Bad Request: SSE GET must not carry a body.' },
              id: null,
            }),
          );
          return;
        }
      }

      // Bearer auth (when configured). Applies to BOTH POST and GET: a
      // stateless GET opens a long-lived standalone SSE stream, and letting
      // it through unauthenticated would allow any remote client to pin
      // connections / read server-initiated notifications.
      if (expectedToken && !isAuthorized(req.headers.authorization, expectedToken)) {
        logSecurityEvent({
          kind: 'transport.auth.missing',
          transport: 'http',
          clientAddr,
          reason: 'missing-or-invalid-bearer',
        });
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

      // Body-size limit (M1). Enforce before parsing.
      if (req.method === 'POST') {
        const contentEncoding = (req.headers['content-encoding'] ?? '').toString().toLowerCase();
        if (contentEncoding && contentEncoding !== 'identity') {
          logSecurityEvent({
            kind: 'transport.content_encoding.rejected',
            transport: 'http',
            clientAddr,
            reason: contentEncoding,
          });
          res.writeHead(415, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Unsupported Media Type: Content-Encoding not supported.' },
              id: null,
            }),
          );
          return;
        }
        const contentType = (req.headers['content-type'] ?? '').toString().toLowerCase();
        if (!contentType.includes('application/json')) {
          logSecurityEvent({
            kind: 'transport.content_type.rejected',
            transport: 'http',
            clientAddr,
            reason: contentType || 'missing',
            meta: { mime: contentType || 'missing' },
          });
          res.writeHead(415, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Unsupported Media Type: expected application/json.' },
              id: null,
            }),
          );
          return;
        }
        const contentLength = Number(req.headers['content-length'] ?? '0');
        if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
          logSecurityEvent({
            kind: 'transport.body.too_large',
            transport: 'http',
            clientAddr,
            reason: 'content-length',
            meta: { limitBytes: maxBodyBytes, observedBytes: contentLength },
          });
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Payload too large.' },
              id: null,
            }),
          );
          return;
        }
        // Stream with a hard accumulator limit; reject once a
        // chunked-encoded body exceeds the budget. The response is flushed
        // BEFORE the socket is destroyed so the client actually receives
        // the 413 (destroying first can RST the connection mid-write).
        const chunks: Buffer[] = [];
        let total = 0;
        let aborted = false;
        req.on('data', (chunk: Buffer) => {
          if (aborted) return;
          total += chunk.length;
          if (total > maxBodyBytes) {
            aborted = true;
            logSecurityEvent({
              kind: 'transport.body.too_large',
              transport: 'http',
              clientAddr,
              reason: 'chunked-accumulator',
              meta: { limitBytes: maxBodyBytes, observedBytes: total },
            });
            res.writeHead(413, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Payload too large.' },
                id: null,
              }),
              () => req.destroy(),
            );
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          if (aborted) return;
          // Parse the body ourselves and hand the MCP transport a parsed
          // JSON object via `parsedBody` — the SDK feeds it straight into
          // its JSON-RPC schema validator, so passing a raw Buffer here
          // would break every request (H-review fix).
          let parsedBody: unknown;
          try {
            parsedBody = total > 0 ? JSON.parse(Buffer.concat(chunks, total).toString('utf8')) : undefined;
          } catch {
            logSecurityEvent({
              kind: 'transport.method.rejected',
              transport: 'http',
              clientAddr,
              reason: 'invalid-json-body',
            });
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32700, message: 'Parse error: Invalid JSON' },
                id: null,
              }),
            );
            return;
          }
          runRequest(serverFactory, req, res, parsedBody, requestToken).catch((err) => {
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
          });
        });
        req.on('error', () => {
          // Connection aborted by the client — nothing to do; `req.destroy`
          // already fired the close handlers.
        });
        return;
      }

      // GET (SSE) — pass straight through to the transport. Auth and
      // body-size checks above already gated this path.
      //
      // M6: account the connection against the concurrency budget and arm
      // an idle reaper that tears the stream down when no bytes have been
      // written for `sseIdleTimeoutMs`.
      if (activeSseClients >= maxSseClients) {
        logSecurityEvent({
          kind: 'transport.sse.limit',
          transport: 'http',
          clientAddr,
          reason: 'max-concurrent-sse-clients',
          meta: { limit: maxSseClients },
        });
        res.writeHead(429, {
          'content-type': 'application/json',
          'retry-after': '5',
        });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Too many concurrent SSE streams.' },
            id: null,
          }),
        );
        return;
      }
      activeSseClients++;
      const releaseSseIdle = sseIdleTimeoutMs > 0 ? armSseIdleReaper(res, sseIdleTimeoutMs) : () => {};
      res.on('close', () => {
        activeSseClients--;
        releaseSseIdle();
      });

      runRequest(serverFactory, req, res, undefined, requestToken).catch((err) => {
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
      });
    },
  );

  await new Promise<void>((resolve) => httpServer.listen(port, hostname, resolve));

  return () =>
    new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
}

/**
 * Hand a (possibly pre-parsed) request to a fresh MCP server instance.
 *
 * GET (SSE) passes `parsedBody = undefined`; POST hands over the parsed
 * JSON-RPC payload so `StreamableHTTPServerTransport` does not re-read
 * (already drained) request stream. `requestToken` (M2) is forwarded to the
 * server factory for request-scoped credential passthrough.
 */
async function runRequest(
  serverFactory: (requestToken?: string) => Server,
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody: unknown,
  requestToken?: string,
): Promise<void> {
  const server = serverFactory(requestToken);
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
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
}

/**
 * Extract the hostname component from a `Host`/`Origin` header value and
 * test it against the allow-list. Hardened against adversarial inputs (L4):
 *  - `undefined`/empty → optional (true for Origin, false for Host)
 *  - Comma-separated `Host: a, b` → rejected
 *  - Embedded NULs / whitespace / control chars → rejected
 *  - Unicode / non-ASCII → rejected (allow-list is ASCII only)
 *  - Trailing dot → stripped
 *  - Lowercased before comparison
 *  - Origin scheme stripped before extraction
 *  - IPv6 brackets unwrapped; bare addresses without brackets allowed only
 *    when they match a known literal entry
 *  - Numeric IPv4 normalised (octal/hex rejected; leading zeros stripped)
 *  - `X-Forwarded-*` and `Forwarded` are intentionally NOT inspected here
 *    — the allow-list compares hostnames, not IPs, and a reverse proxy that
 *    sets `X-Forwarded-Host` is a deployment-time configuration concern.
 *
 * Exported for unit testing — call sites inside `startHttp` use it directly.
 */
export function checkHostHeader(
  headerValue: string | string[] | undefined,
  allowed: Set<string>,
  optional = false,
): boolean {
  if (headerValue === undefined) return optional;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) return optional;

  // Multi-value Host is invalid per RFC 7230 §5.4 — reject to avoid
  // ambiguous `Host: a, b` parsing tricks.
  if (Array.isArray(headerValue) && headerValue.length > 1) return false;
  if (raw.includes(',') || raw.includes('\0')) return false;

  // Reject control characters / whitespace BEFORE trimming — otherwise
  // a hostile `Host: localhost\t` would slip through.
  if (/[\x00-\x1f\x7f\s]/.test(raw)) return false;
  // Unicode (IDN/punycode) — reject; the allow-list is ASCII only.
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(raw)) return false;

  let host = raw.trim().toLowerCase();
  // Strip trailing dot (`localhost.` → `localhost`) for both IPv4 and DNS.
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host) return false;

  // Origin may include a scheme: strip it.
  const schemeMatch = host.match(/^[a-z]+:\/\/([^/:]+)/);
  if (schemeMatch) host = schemeMatch[1];
  if (!host) return false;

  // Unwrap IPv6 brackets ([::1]) and strip :port. Bare IPv6 addresses
  // without brackets are also accepted (Node usually sends bracketed).
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    host = end !== -1 ? host.slice(1, end) : host;
  } else {
    // Strip a single trailing :port (but only one — `host:80:80` is hostile).
    const firstColon = host.indexOf(':');
    if (firstColon !== -1) {
      // If there are multiple colons and the value isn't bracketed, treat
      // the whole thing as a bare IPv6 literal (e.g. `::1`).
      const lastColon = host.lastIndexOf(':');
      if (firstColon === lastColon) {
        host = host.slice(0, firstColon);
      }
    }
  }

  // Reject IPv4-mapped IPv6 that doesn't represent loopback. We never
  // want to treat `[::ffff:1.2.3.4]` as a loopback address just because
  // the prefix looks familiar.
  if (/^::ffff:/i.test(host)) {
    return false;
  }

  // Numeric IPv4 — strip leading zeros from each octet to thwart
  // `127.000.000.001` octal/decimal obfuscation.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const canonical = ipv4.slice(1, 5).map((oct) => String(Number(oct))).join('.');
    if (canonical !== host) host = canonical;
  }

  return allowed.has(host);
}

/**
 * Extract a `Bearer` token from an `Authorization` header value, or
 * `undefined` when the header is absent/malformed. Used for M2 credential
 * passthrough — unlike {@link isAuthorized} this performs no comparison.
 */
function extractBearerToken(headerValue: string | string[] | undefined): string | undefined {
  if (!headerValue) return undefined;
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!raw) return undefined;
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 2) return undefined;
  if (parts[0].toLowerCase() !== 'bearer') return undefined;
  return parts[1] || undefined;
}

/**
 * Arm an idle reaper on an SSE response stream (M6). Every successful
 * `res.write` resets the timer; when the stream stays silent for
 * `idleTimeoutMs` the socket is destroyed. Returns a disarm function —
 * callers invoke it from the response `close` handler.
 */
function armSseIdleReaper(res: ServerResponse, idleTimeoutMs: number): () => void {
  let timer: NodeJS.Timeout | undefined;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      // Destroy (not end): an idle SSE client gets a clean close either
      // way, and destroy guarantees the server-side transport `close`
      // handlers fire even if the peer stopped reading.
      res.destroy();
    }, idleTimeoutMs);
    // Never let the reaper keep the event loop alive on its own.
    timer.unref();
  };

  const originalWrite = res.write.bind(res);
  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    arm();
    return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof res.write;

  arm();
  return () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
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
