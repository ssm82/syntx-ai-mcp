import { BaseClient } from '../client';
import type { AIService, AIModel } from '../types';

/**
 * Resource for AI services and models.
 */
export class AIResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * List all available AI services (e.g. Midjourney, Sora, Flux).
   * GET /api/v1/ai
   */
  async listServices(): Promise<AIService[]> {
    return this.client.get<AIService[]>('/api/v1/ai');
  }

  /**
   * List detailed AI models with upload constraints and features.
   * GET /api/v1/ai/models
   */
  async listModels(): Promise<AIModel[]> {
    return this.client.get<AIModel[]>('/api/v1/ai/models');
  }
}
