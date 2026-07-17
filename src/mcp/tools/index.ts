import type { SyntxTool } from '../registry';
import { authTools } from './auth';
import { userTools } from './user';
import { aiTools } from './ai';
import { chatsTools } from './chats';
import { designTools } from './design';
import { filesTools } from './files';

/**
 * Central registry of all MCP tools exposed by syntx-ai-mcp.
 * New tool modules must be imported and spread here to become available.
 */
export const allTools: SyntxTool[] = [
  ...authTools,
  ...userTools,
  ...aiTools,
  ...chatsTools,
  ...designTools,
  ...filesTools,
];
