import { SyntxAPIError, SyntxAuthError } from '../errors';
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
