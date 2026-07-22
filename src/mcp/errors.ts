import { SyntxAPIError, SyntxAuthError, SyntxAbortError, SyntxTimeoutError } from '../errors';
import type { SyntxToolContent, SyntxToolResult } from './registry';

/**
 * Convert any thrown value into a non-fatal MCP tool error.
 *
 * Returning `{ isError: true }` (instead of throwing) keeps the JSON-RPC
 * channel intact and lets the AI assistant react — e.g. prompt for a token
 * after a 401.
 */
export function toMcpError(error: unknown, context?: string): SyntxToolResult {
  const prefix = context ? `${context}: ` : '';

  if (error instanceof SyntxAuthError) {
    return toolError(
      `${prefix}Authentication required or invalid. Use the "set-token" tool to provide a valid syntx.ai token. (${error.message})`,
    );
  }

  if (error instanceof SyntxTimeoutError) {
    // Recovery hint is the whole point of the structured error: the chat
    // persists server-side, so the assistant can resume instead of
    // re-sending the prompt (duplicate chat + double token spend).
    const recovery = error.chatId
      ? ` The chat persists on the server — recover the reply with ` +
        `get-messages(chat_id="${error.chatId}") or resume waiting with ` +
        `wait-for-response(chat_id="${error.chatId}"). Do NOT re-send the prompt.`
      : '';
    return toolError(
      `${prefix}${error.message} (elapsed ${error.elapsedMs} ms of ${error.timeoutMs} ms budget).${recovery}`,
    );
  }

  if (error instanceof SyntxAbortError) {
    return toolError(`${prefix}Cancelled: ${error.message}`);
  }

  if (error instanceof SyntxAPIError) {
    const detail =
      error.responseBody !== undefined
        ? ` ${typeof error.responseBody === 'string' ? error.responseBody : JSON.stringify(error.responseBody)}`
        : '';
    return toolError(
      `${prefix}syntx.ai API error ${error.status}${error.code ? ` [${error.code}]` : ''}: ${error.message}${detail}`,
    );
  }

  return toolError(`${prefix}${error instanceof Error ? error.message : String(error)}`);
}

export function toolError(text: string): SyntxToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/** Wrap any text payload into a single-text success result. */
export function textResult(text: string): SyntxToolResult {
  return { content: [{ type: 'text', text }] };
}

export type { SyntxToolContent };
