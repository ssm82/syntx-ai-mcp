/**
 * Minimal structured security-event log.
 *
 * Writes a single-line JSON record to stderr (never stdout, which is reserved
 * for JSON-RPC under stdio transport). The payload is sanitised to avoid
 * leaking secrets, raw file paths, or request bodies — only structured
 * identifiers and high-level reasons are emitted.
 *
 * Usage:
 *   logSecurityEvent({ kind: 'transport.host.rejected', transport: 'http', clientAddr: '127.0.0.1' });
 *
 * In 0.2.1 this is a hand-rolled logger; if volume grows we can swap it for
 * `pino` without changing the call sites.
 */

export type SecurityEventKind =
  | 'transport.host.rejected'
  | 'transport.origin.rejected'
  | 'transport.method.rejected'
  | 'transport.body.too_large'
  | 'transport.content_encoding.rejected'
  | 'transport.content_type.rejected'
  | 'transport.auth.missing'
  | 'transport.sse.limit'
  | 'upload-files.path.rejected'
  | 'transcribe.mime.rejected'
  | 'auth-mutation.rejected'
  | 'auth-mutation.completed';

export interface SecurityEvent {
  /** Short stable identifier — grouped on by downstream tooling. */
  kind: SecurityEventKind;
  /** Transport the request came in on. */
  transport: string;
  /** Optional client address (best-effort; never trust it as authoritative). */
  clientAddr?: string;
  /** Optional low-cardinality reason — never include secrets or raw user input. */
  reason?: string;
  /** Optional structured metadata (e.g. tool name, header name). */
  meta?: Record<string, string | number | boolean>;
}

/**
 * Forward-compat allow-list of metadata keys. Prevents accidental leakage of
 * arbitrary caller-supplied fields if a future caller passes a `meta` blob.
 */
const ALLOWED_META_KEYS = new Set([
  'tool',
  'header',
  'method',
  'limitBytes',
  'observedBytes',
  'limit',
  'mime',
  'source',
]);

function sanitiseEvent(event: SecurityEvent): SecurityEvent {
  const safe: SecurityEvent = {
    kind: event.kind,
    transport: event.transport,
  };
  if (typeof event.clientAddr === 'string' && event.clientAddr.length > 0) {
    safe.clientAddr = event.clientAddr;
  }
  if (typeof event.reason === 'string' && event.reason.length > 0) {
    safe.reason = event.reason;
  }
  if (event.meta) {
    const meta: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(event.meta)) {
      if (ALLOWED_META_KEYS.has(k)) meta[k] = v;
    }
    if (Object.keys(meta).length > 0) safe.meta = meta;
  }
  return safe;
}

/**
 * Emit a security event to stderr as a single-line JSON record.
 *
 * Never throws; logging must not break the request lifecycle.
 */
export function logSecurityEvent(event: SecurityEvent): void {
  try {
    const safe = sanitiseEvent(event);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      component: 'syntx-mcp',
      ...safe,
    });
    process.stderr.write(line + '\n');
  } catch {
    // Best-effort logging — if JSON.stringify fails we drop the event
    // rather than risk crashing the request handler.
  }
}
