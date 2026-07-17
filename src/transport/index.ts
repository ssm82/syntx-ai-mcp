import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { TransportKind } from '../config';
import { startStdio } from './stdio';
import { startHttp } from './http';

export { startStdio, startHttp };

export interface TransportRunResult {
  /** Stops the running transport (closes the HTTP server; stdio is a no-op). */
  stop?: () => Promise<void>;
}

/**
 * Connect MCP servers to the requested transport and keep them running.
 *
 * - **stdio**: a single long-lived server instance serves the whole process.
 * - **http**: stateless — a fresh server is built from `serverFactory` for
 *   each request (see {@link startHttp}).
 */
export async function runTransport(
  serverFactory: () => Server,
  kind: TransportKind,
  httpPort: number,
): Promise<TransportRunResult> {
  if (kind === 'http') {
    const stop = await startHttp(serverFactory, httpPort);
    return { stop };
  }
  await startStdio(serverFactory());
  return {};
}
