// ── SDK layer ───────────────────────────────────────────────────────────────
export { SyntxClient } from './syntx-client';
export { BaseClient, type SyntxClientConfig } from './client';
export { SyntxAuth } from './auth';
export {
  SyntxWebSocket,
  type WSSMessage,
  type StreamingMessage,
  type SyntxWebSocketOptions,
} from './websocket';
export { SyntxAPIError, SyntxAuthError, SyntxAbortError, SyntxTimeoutError } from './errors';

export * from './types';
export { collectCompletedObjects } from './resources/chats';

export { AIResource, type GetModelInfoParams } from './resources/ai';
export { UserResource, toPublicUser } from './resources/user';
export {
  ChatsResource,
  type ListChatsParams,
  type ListMessagesParams,
  type CreateChatParams,
  type SendMessageParams,
  type SendChatMessageParams,
  type UploadResult,
  type UploadFileInput,
} from './resources/chats';
export { PlansResource } from './resources/plans';
export { NotificationsResource, type ListNotificationsParams } from './resources/notifications';
export { FoldersResource, SettingsResource } from './resources/folders-settings';
export type { CreateFolderParams, CreatedFolder } from './resources/folders-settings';
export { DesignResource, type GenerateDesignParams } from './resources/design';
export { AudioResource, type ListVoiceExamplesParams, type GenerateAudioParams } from './resources/audio';
export { VideoResource, type GenerateVideoParams } from './resources/video';
export { AppResource } from './resources/app';

// ── MCP server layer ────────────────────────────────────────────────────────
export { createMcpServer } from './mcp/server';
export { createMcpContext, withRequestContext } from './mcp/context';
export type { McpContext, SyntxToolExtra } from './mcp/registry';
export type {
  SyntxTool,
  SyntxResource,
  SyntxResourceTemplate,
  SyntxPrompt,
  SyntxToolResult,
} from './mcp/registry';
export { allTools } from './mcp/tools';
export { allResources, allResourceTemplates } from './mcp/resources';
export { allPrompts } from './mcp/prompts';

// ── Config & transport ──────────────────────────────────────────────────────
export { loadConfig, DEFAULT_CONFIG, ENV_KEYS } from './config';
export type { McpServerConfig, TransportKind, StreamMode } from './config';
export { runTransport, startStdio, startHttp } from './transport';
