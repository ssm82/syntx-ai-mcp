import * as fs from 'node:fs/promises';
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
    const abs = path.resolve(item.path!);
    const stat = await fs.stat(abs).catch(() => {
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
    const buffer = await fs.readFile(abs);
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