import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { TransportKind } from '../config';
import { startStdio } from './stdio';
import { startHttp } from './http';

export { startStdio, startHttp };
export type { HttpTransportOptions } from './http';

export interface TransportRunResult {
  /** Stops the running transport (closes the HTTP server; stdio is a no-op). */
  stop?: () => Promise<void>;
}

/** HTTP transport options threaded through {@link runTransport}. */
export interface RunTransportHttpOptions {
  hostname?: string;
  httpToken?: string;
}

/**
 * Connect MCP servers to the requested transport and keep them running.
 *
 * - **stdio**: a single long-lived server instance serves the whole process.
 * - **http**: stateless — a fresh server is built from `serverFactory` for
 *   each request (see {@link startHttp}). `httpOptions` carries the bind
 *   hostname and optional bearer token.
 */
export async function runTransport(
  serverFactory: () => Server,
  kind: TransportKind,
  httpPort: number,
  httpOptions: RunTransportHttpOptions = {},
): Promise<TransportRunResult> {
  if (kind === 'http') {
    const stop = await startHttp({
      serverFactory,
      port: httpPort,
      hostname: httpOptions.hostname,
      httpToken: httpOptions.httpToken,
    });
    return { stop };
  }
  await startStdio(serverFactory());
  return {};
}
