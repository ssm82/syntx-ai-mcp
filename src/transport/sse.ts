/**
 * Minimal Server-Sent Events client.
 *
 * Designed for the `sse.syntx.ai` stream used by the text-flow `llm/*`
 * namespace. The server emits text/event-stream frames of the form
 *
 *   event: <type>
 *   data: <payload>
 *   <blank line>
 *
 * Multi-line `data:` lines are joined with `\n` per the WHATWG spec.
 * `event: ping` frames are no-ops used as keep-alives.
 */

export interface SseEvent {
  /** Event type from the `event:` line. Defaults to `'message'`. */
  event: string;
  /** Concatenated `data:` payload (multi-line joined by `\n`). */
  data: string;
}

export interface OpenSseOptions {
  url: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onEvent: (event: SseEvent) => void;
}

export interface SseHandle {
  /** True once the stream finished (complete/cancelled/error/network). */
  closed: boolean;
  /** Promise that resolves when the underlying reader finishes. */
  done: Promise<void>;
  /** Tear down the stream and abort any in-flight fetch. */
  close(): void;
}

/**
 * Open an SSE connection and dispatch frames via `onEvent`.
 *
 * Returns a handle whose `close()` aborts the underlying fetch (if still
 * open) and tears down the reader. Safe to call multiple times.
 */
export function openSse(opts: OpenSseOptions): SseHandle {
  const controller = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let resolveDone: () => void = () => {};
  let rejectDone: (err: unknown) => void = () => {};
  const donePromise = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const handle: SseHandle = {
    closed: false,
    done: donePromise,
    close,
  };

  (async () => {
    try {
      let response: Response;
      try {
        response = await fetch(opts.url, {
          method: 'GET',
          headers: opts.headers,
          signal: controller.signal,
        });
      } catch (err) {
        handle.closed = true;
        rejectDone(err);
        return;
      }

      if (!response.ok || !response.body) {
        handle.closed = true;
        rejectDone(new Error(`SSE connection failed: ${response.status} ${response.statusText}`));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = dispatchFrames(buffer, opts.onEvent);
        }
        // Flush any trailing bytes that did not end in \n\n.
        buffer += decoder.decode();
        if (buffer.trim().length > 0) {
          buffer = dispatchFrames(buffer + '\n\n', opts.onEvent);
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
        handle.closed = true;
      }
      resolveDone();
    } catch (err) {
      handle.closed = true;
      rejectDone(err);
    }
  })();

  return handle;

  function close(): void {
    if (handle.closed) return;
    handle.closed = true;
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
    resolveDone();
  }
}

/**
 * Parse SSE frames out of `buffer`, dispatch each complete one, and return
 * the leftover (incomplete) prefix. A blank line terminates a frame; multi-
 * line `data:` is joined with `\n`.
 */
export function dispatchFrames(
  buffer: string,
  onEvent: (event: SseEvent) => void,
): string {
  let start = 0;
  while (true) {
    const idx = buffer.indexOf('\n\n', start);
    if (idx === -1) return buffer.slice(start);
    const raw = buffer.slice(start, idx);
    start = idx + 2;
    const parsed = parseFrame(raw);
    if (!parsed) continue;
    if (parsed.event === 'ping') continue;
    onEvent(parsed);
  }
}

/**
 * Parse one SSE frame. Returns `null` for empty / comment-only frames.
 * Exported for testability — application code uses `dispatchFrames`.
 */
export function parseFrame(raw: string): SseEvent | null {
  const lines = raw.split('\n');
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      let d = line.slice('data:'.length);
      if (d.startsWith(' ')) d = d.slice(1);
      dataLines.push(d);
    }
  }
  if (dataLines.length === 0 && event === 'message') return null;
  return { event, data: dataLines.join('\n') };
}
