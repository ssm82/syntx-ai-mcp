import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Buffer } from 'node:buffer';

/**
 * One user-supplied file entry for the `upload-files` MCP tool.
 *
 * The tool accepts both shapes per file:
 *   • `{ path }` — read from the MCP server's filesystem
 *   • `{ content_base64 }` — inline base64 (optionally with a `data:` URL prefix)
 *
 * Exactly one of `path` / `content_base64` must be set per item.
 */
export interface FileInputSpec {
  path?: string;
  content_base64?: string;
  /** Optional explicit filename. Required when `content_base64` is used. */
  filename?: string;
  /** Optional MIME type hint. Auto-detected for `path` inputs. */
  mime_type?: string;
}

export interface ResolvedFile {
  buffer: Uint8Array;
  filename: string;
  mimeType: string | undefined;
  /** Final source — `"path" | "base64"`. Used for diagnostics. */
  source: 'path' | 'base64';
}

/** Hard limits enforced by the tool. Sized for typical LLM agent payloads. */
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB per file
export const MAX_FILES_PER_CALL = 10;

/** Minimal MIME-type guess from extension. Keep table short — server may override. */
const EXT_TO_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.mpeg': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function guessMimeFromExt(filename: string): string | undefined {
  return EXT_TO_MIME[path.extname(filename).toLowerCase()];
}

/** Strip `data:<mime>;base64,` prefix if present, then decode. */
function decodeBase64(input: string): Buffer {
  const comma = input.indexOf(',');
  const body = input.startsWith('data:') && comma !== -1 ? input.slice(comma + 1) : input;
  const cleaned = body.replace(/\s+/g, '');
  return Buffer.from(cleaned, 'base64');
}

// ── Path-input policy (H1) ──────────────────────────────────────────────────

/**
 * Normalized MCP transport kinds. Mirrors `McpServerConfig['transport']` —
 * kept duplicated here so this module has no MCP/transport import cycles.
 */
export type Transport = 'stdio' | 'http' | 'unknown';

/** Result of resolving an allowed-roots list from env. */
export interface AllowedRootsConfig {
  /** Resolved, real-path-normalized root directories. */
  roots: string[];
  /** The original raw configuration (for diagnostics). */
  source: 'env' | 'default';
}

/**
 * Resolve the list of filesystem roots that `path`-inputs are allowed to
 * resolve into. Default is `[process.cwd()]` — we deliberately do NOT
 * include `os.tmpdir()` (world-writable, attacker-controlled).
 *
 * Override via the `MCP_FILE_ROOTS` env var (comma-separated absolute paths).
 * Relative paths in the env var are resolved against `process.cwd()`.
 *
 * Roots are normalised with `fs.realpathSync` once at call time, so a
 * symlink to `/etc` cannot smuggle a forbidden location.
 */
export function resolveAllowedRoots(env: NodeJS.ProcessEnv = process.env): AllowedRootsConfig {
  const raw = env.MCP_FILE_ROOTS;
  if (raw && raw.trim().length > 0) {
    const roots = raw
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)))
      .map((p) => {
        try {
          return fs.realpathSync(p);
        } catch {
          // Fall back to the literal path; downstream `realpathSync` will
          // surface a clear "not found" error.
          return p;
        }
      });
    if (roots.length > 0) return { roots, source: 'env' };
  }
  let cwd: string;
  try {
    cwd = fs.realpathSync(process.cwd());
  } catch {
    cwd = path.resolve(process.cwd());
  }
  return { roots: [cwd], source: 'default' };
}

/**
 * Throw if `source === 'path'` while `transport !== 'stdio'`.
 *
 * This is the headline LFI defence for the HTTP transport: a remote client
 * must never be able to direct the server to read an arbitrary file off its
 * filesystem via the MCP tool surface.
 */
export function assertPathSourceAllowed(source: 'path' | 'base64', transport: Transport): void {
  if (source === 'path' && transport !== 'stdio') {
    throw new Error(
      '`path` is not permitted over the HTTP transport (server-side file read). ' +
        'Send the payload inline via `content_base64` instead.',
    );
  }
}

/**
 * Normalise `inputPath` against the allow-list of roots and verify:
 *   • the path resolves to an existing regular file
 *   • it is not a FIFO / socket / device
 *   • its size is within `maxBytes` (cheap stat-based pre-check)
 *
 * Returns the realpath-resolved absolute path on success; throws on violation.
 * The returned path is safe to pass to `fs.readFile` without further
 * canonicalisation.
 */
export function resolveSafePath(
  inputPath: string,
  allowedRoots: string[],
  maxBytes: number = MAX_FILE_SIZE,
): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('`path` must be a non-empty string.');
  }
  const abs = path.resolve(inputPath);
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    throw new Error(`File not found or not readable: ${inputPath}`);
  }
  // Prefix check using path-aware comparison (handles trailing separators and
  // case-insensitive filesystems on macOS/Windows for the directory portion).
  const normalizedReal = process.platform === 'win32' ? real.toLowerCase() : real;
  const ok = allowedRoots.some((root) => {
    const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root;
    const withSep = normalizedRoot.endsWith(path.sep)
      ? normalizedRoot
      : normalizedRoot + path.sep;
    return normalizedReal === normalizedRoot || normalizedReal.startsWith(withSep);
  });
  if (!ok) {
    throw new Error(
      `Path is outside of allowed roots: ${inputPath}. ` +
        'Set MCP_FILE_ROOTS to expand the allow-list (default: process.cwd()).',
    );
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch {
    throw new Error(`File not found or not readable: ${inputPath}`);
  }
  if (!stat.isFile()) {
    const kind = stat.isDirectory()
      ? 'directory'
      : stat.isSymbolicLink()
        ? 'symlink'
        : stat.isFIFO()
          ? 'FIFO/pipe'
          : stat.isSocket()
            ? 'socket'
            : stat.isBlockDevice() || stat.isCharacterDevice()
              ? 'device'
              : 'special file';
    throw new Error(`Path is a ${kind}, not a regular file: ${inputPath}`);
  }
  if (stat.size > maxBytes) {
    throw new Error(
      `File too large: ${stat.size} bytes (limit ${maxBytes}). Use a smaller file.`,
    );
  }
  return real;
}

/** Resolve a single file spec into bytes + filename + mime. Throws on misuse. */
export async function resolveFileInput(item: FileInputSpec): Promise<ResolvedFile> {
  const hasPath = typeof item.path === 'string' && item.path.length > 0;
  const hasBase64 = typeof item.content_base64 === 'string' && item.content_base64.length > 0;

  if (hasPath && hasBase64) {
    throw new Error('Provide either `path` or `content_base64`, not both.');
  }
  if (!hasPath && !hasBase64) {
    throw new Error('Each file entry must include `path` or `content_base64`.');
  }

  if (hasPath) {
    // H1: callers are responsible for invoking `assertPathSourceAllowed` and
    // `resolveAllowedRoots` before passing `transport` / `allowedRoots` here.
    // This function stays transport-agnostic so unit tests stay simple.
    const abs = path.resolve(item.path!);
    const stat = await fsp.stat(abs).catch(() => {
      throw new Error(`File not found or not readable: ${item.path}`);
    });
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${item.path}`);
    }
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${stat.size} bytes (limit ${MAX_FILE_SIZE}). Use a smaller file.`,
      );
    }
    const buffer = await fsp.readFile(abs);
    const filename = item.filename ?? path.basename(abs);
    const mimeType = item.mime_type ?? guessMimeFromExt(filename);
    return { buffer, filename, mimeType, source: 'path' };
  }

  // base64 path
  if (!item.filename) {
    throw new Error('`filename` is required when uploading via `content_base64`.');
  }
  const buffer = decodeBase64(item.content_base64!);
  if (buffer.byteLength > MAX_FILE_SIZE) {
    throw new Error(
      `Decoded payload too large: ${buffer.byteLength} bytes (limit ${MAX_FILE_SIZE}).`,
    );
  }
  return {
    buffer,
    filename: item.filename,
    mimeType: item.mime_type ?? guessMimeFromExt(item.filename),
    source: 'base64',
  };
}

/** Resolve an array of file specs with per-item limit + total count guard. */
export async function resolveFileInputs(items: FileInputSpec[]): Promise<ResolvedFile[]> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('`files` must be a non-empty array.');
  }
  if (items.length > MAX_FILES_PER_CALL) {
    throw new Error(
      `Too many files in one call: ${items.length} (limit ${MAX_FILES_PER_CALL}).`,
    );
  }
  return Promise.all(items.map(resolveFileInput));
}
