import { BaseClient } from '../client';
import { SyntxAbortError } from '../errors';
import { openSse } from '../transport/sse';
import type {
  LlmLimits,
  RawLlmLimitWindow,
  LlmLimitWindow,
  LlmGenerateParams,
  LlmGenerateResponse,
  LlmModel,
  LlmListModelsParams,
  LlmStreamJob,
  CompletedMessage,
  Message,
} from '../types';

interface WaitForResponseOptions {
  timeout?: number;
  signal?: AbortSignal;
  sseTimeoutMs?: number;
  onProgress?: (elapsedMs: number, timeoutMs: number) => void;
  llmSseBaseUrl?: string;
  fallbackPoll?: (chatId: string, opts: { timeout?: number; signal?: AbortSignal }) => Promise<CompletedMessage>;
}

/**
 * Resource for the text-flow `llm/*` namespace used by the prod-SPA bundle.
 *
 * Endpoints:
 *  - `POST /api/v1/llm/generate?ai_name=…`
 *  - `GET  /api/v1/llm/models`
 *  - `GET  /api/v1/llm/chats/{chatId}/stream`
 *  - `GET  /api/v1/llm/limits`
 *
 * The companion SSE stream lives on `sse.syntx.ai`; see
 * {@link LlmResource.waitForResponse} for the full flow.
 */
export class LlmResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * Current LLM usage limits (6h and 7d windows). GET /api/v1/llm/limits.
   *
   * Windows with `expires_at === null` or `expires_at` already in the past
   * are normalised to `{ percent_left: 100, started_at: null, expires_at: null }`
   * so callers never have to re-implement that rule.
   */
  async getLimits(): Promise<LlmLimits> {
    const res = await this.client.get<{
      window_6h: RawLlmLimitWindow | null;
      window_7d: RawLlmLimitWindow | null;
    }>('/api/v1/llm/limits');
    return {
      window_6h: normalizeWindow(res.window_6h),
      window_7d: normalizeWindow(res.window_7d),
    };
  }

  async generate(params: LlmGenerateParams): Promise<LlmGenerateResponse> {
    // Live SPA capture (2026-09-21):
    //   body: { chat_uuid?, text, model, thinking?, plan?, deep_research?, tools? }
    //   query: ai_name=…
    const model = params.modelType ?? 'gpt-5.6-luna';
    const body: Record<string, unknown> = { text: params.prompt, model };
    if (params.chatUuid) body.chat_uuid = params.chatUuid;
    if (params.thinking !== undefined) body.thinking = params.thinking;
    if (params.plan !== undefined) body.plan = params.plan;
    if (params.deepResearch !== undefined) body.deep_research = params.deepResearch;
    if (params.tools) body.tools = params.tools;
    return this.client.post<LlmGenerateResponse>(
      '/api/v1/llm/generate',
      body,
      { ai_name: params.aiName },
    );
  }

  async listModels(params?: LlmListModelsParams): Promise<LlmModel[]> {
    type ListModelsResponse = { models?: unknown };
    const res = await this.client.get<ListModelsResponse>(
      '/api/v1/llm/models',
      {
        enabled_only: params?.enabled_only,
        lang: params?.lang,
      },
    );
    if (Array.isArray(res)) return res as LlmModel[];
    if (res && Array.isArray((res as { models?: unknown }).models)) {
      return (res as { models: LlmModel[] }).models;
    }
    return [];
  }

  async getChatStream(chatId: string): Promise<{ jobs: LlmStreamJob[] }> {
    type StreamJobsResponse = { jobs?: unknown };
    const res = await this.client.get<StreamJobsResponse>(
      `/api/v1/llm/chats/${encodeURIComponent(chatId)}/stream`,
    );
    if (res && Array.isArray(res.jobs)) {
      return { jobs: res.jobs as LlmStreamJob[] };
    }
    return { jobs: [] };
  }

  async waitForResponse(
    chatId: string,
    opts?: WaitForResponseOptions,
  ): Promise<CompletedMessage> {
    const timeout = opts?.timeout ?? 600000;
    const sseTimeoutMs = opts?.sseTimeoutMs ?? Math.floor(timeout * 0.6);
    const llmSseBaseUrl = (opts?.llmSseBaseUrl ?? 'https://sse.syntx.ai').replace(/\/$/, '');

    const start = Date.now();
    const remaining = () => Math.max(0, timeout - (Date.now() - start));

    const jobs = await this.getChatStream(chatId);
    const job = jobs.jobs[0];
    if (!job) {
      // Nothing to wait for — fall straight through to polling, which will
      // either return the completed reply (if it was already generated) or
      // time out gracefully.
      return pollFallback(chatId, opts, timeout);
    }

    const sseUrl = resolveSseUrl(llmSseBaseUrl, job.stream_url);
    const text = await consumeSse(sseUrl, sseTimeoutMs, opts?.signal, opts?.onProgress, timeout, start);

    if (text.kind === 'ok' || text.kind === 'cancelled') {
      return buildCompletedMessage(chatId, text.text, job.message_id);
    }

    if (text.kind === 'aborted') {
      throw new SyntxAbortError(`Wait cancelled in chat ${chatId}`);
    }

    // Timeout / error → fall back to REST polling for the remainder of the budget.
    const left = remaining();
    if (left <= 0) {
      throw new Error(`Timeout waiting for response in chat ${chatId}`);
    }
    return pollFallback(chatId, opts, left);
  }
}

type SseOutcome =
  | { kind: 'ok'; text: string }
  | { kind: 'cancelled'; text: string }
  | { kind: 'aborted' }
  | { kind: 'timeout' }
  | { kind: 'error' };

async function consumeSse(
  url: string,
  sseTimeoutMs: number,
  signal: AbortSignal | undefined,
  onProgress: ((elapsed: number, total: number) => void) | undefined,
  timeout: number,
  start: number,
): Promise<SseOutcome> {
  return new Promise((resolve) => {
    const accumulated: string[] = [];
    let settled = false;
    const settle = (o: SseOutcome) => {
      if (settled) return;
      settled = true;
      handle.close();
      resolve(o);
    };

    const handle = openSse({
      url,
      headers: { Accept: 'text/event-stream' },
      signal,
      onEvent: (event) => {
        try {
          onProgress?.(Date.now() - start, timeout);
        } catch {
          /* heartbeat is best-effort */
        }
        if (event.event === 'message') {
          accumulated.push(event.data);
        } else if (event.event === 'complete') {
          settle({ kind: 'ok', text: accumulated.join('\n') });
        } else if (event.event === 'cancelled') {
          settle({ kind: 'cancelled', text: accumulated.join('\n') });
        } else if (event.event === 'error') {
          settle({ kind: 'error' });
        }
        // ping / unknown events are ignored.
      },
    });

    handle.done.then(
      () => {
        if (!settled) settle({ kind: 'ok', text: accumulated.join('\n') });
      },
      () => {
        if (!settled) settle({ kind: 'error' });
      },
    );

    if (signal) {
      signal.addEventListener('abort', () => settle({ kind: 'aborted' }), { once: true });
    }
    setTimeout(() => settle({ kind: 'timeout' }), sseTimeoutMs);
  });
}

function resolveSseUrl(baseUrl: string, streamUrl: string): string {
  if (/^https?:\/\//i.test(streamUrl)) return streamUrl;
  const trimmed = streamUrl.replace(/^\/+/, '');
  return `${baseUrl}/${trimmed}`;
}

function buildCompletedMessage(chatId: string, text: string, messageId: string): CompletedMessage {
  const now = new Date().toISOString();
  const message: Message = {
    id: messageId,
    chat_id: chatId,
    author_id: -1,
    created_at: now,
    updated_at: now,
    is_favorite: false,
    message_object: [
      {
        id: 0,
        message_id: 0,
        object_type: 'text',
        object_url: null,
        object_text: text,
        completed: true,
        created_at: now,
        updated_at: now,
        model_type: null,
        metadata: null,
      },
    ],
  };
  return { text, media: [], message };
}

async function pollFallback(
  chatId: string,
  opts: WaitForResponseOptions | undefined,
  timeoutMs: number,
): Promise<CompletedMessage> {
  if (opts?.fallbackPoll) {
    return opts.fallbackPoll(chatId, { timeout: timeoutMs, signal: opts.signal });
  }
  // No fallback wired in (e.g. SDK used standalone). Surface a synthetic
  // empty reply so callers still get a well-typed CompletedMessage rather
  // than a hang or a thrown error. The MCP layer wires a real fallback.
  return buildCompletedMessage(chatId, '', '');
}

/**
 * Apply the SPA-observed normalisation rule to a single window:
 *  - `null` in → `null` out (no such limit configured for the user/model).
 *  - Missing/expired `expires_at` → fully reset window (`percent_left: 100`,
 *    no start/expiry timestamps).
 *  - Otherwise pass the wire values through unchanged.
 */
function normalizeWindow(raw: RawLlmLimitWindow | null | undefined): LlmLimitWindow | null {
  if (raw === null || raw === undefined) return null;

  const expiresAt = raw.expires_at ?? null;
  const expired =
    expiresAt === null ||
    expiresAt === undefined ||
    (typeof expiresAt === 'string' && !Number.isNaN(Date.parse(expiresAt)) && Date.parse(expiresAt) <= Date.now());

  if (expired) {
    return { percent_left: 100, started_at: null, expires_at: null };
  }

  return {
    percent_left: typeof raw.percent_left === 'number' ? raw.percent_left : 0,
    started_at: raw.started_at ?? null,
    expires_at: expiresAt,
  };
}
