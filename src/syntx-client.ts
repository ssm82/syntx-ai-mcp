import { BaseClient, SyntxClientConfig } from './client';
import { SyntxAuth } from './auth';
import { AIResource } from './resources/ai';
import { UserResource } from './resources/user';
import { ChatsResource } from './resources/chats';
import { PlansResource } from './resources/plans';
import { NotificationsResource } from './resources/notifications';
import { FoldersResource, SettingsResource } from './resources/folders-settings';
import { DesignResource } from './resources/design';
import { AudioResource } from './resources/audio';
import { VideoResource } from './resources/video';
import { AppResource } from './resources/app';

/**
 * Main entry point for the Syntx AI SDK.
 *
 * Provides typed access to all syntx.ai API resources.
 *
 * @example
 * ```ts
 * const syntx = new SyntxClient({ token: 'your-api-token' });
 * const user = await syntx.user.me();
 * const models = await syntx.ai.listModels();
 * ```
 */
export class SyntxClient {
  private readonly client: BaseClient;

  readonly auth: SyntxAuth;
  readonly ai: AIResource;
  readonly user: UserResource;
  readonly chats: ChatsResource;
  readonly plans: PlansResource;
  readonly notifications: NotificationsResource;
  readonly folders: FoldersResource;
  readonly settings: SettingsResource;
  readonly design: DesignResource;
  readonly audio: AudioResource;
  readonly video: VideoResource;
  readonly app: AppResource;

  constructor(config?: SyntxClientConfig) {
    this.client = new BaseClient(config);

    this.auth = new SyntxAuth(this.client);
    this.ai = new AIResource(this.client);
    this.user = new UserResource(this.client);
    this.chats = new ChatsResource(this.client);
    this.plans = new PlansResource(this.client);
    this.notifications = new NotificationsResource(this.client);
    this.folders = new FoldersResource(this.client);
    this.settings = new SettingsResource(this.client);
    this.design = new DesignResource(this.client);
    this.audio = new AudioResource(this.client);
    this.video = new VideoResource(this.client);
    this.app = new AppResource();
  }

  /**
   * Direct access to the underlying HTTP client for advanced use cases.
   */
  get http(): BaseClient {
    return this.client;
  }
}
