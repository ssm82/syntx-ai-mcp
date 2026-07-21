import { BaseClient } from '../client';
import type { AIService, AIModel, ModelInfoV2 } from '../types';

export interface GetModelInfoParams {
  ai_name: string;
  model_type: string;
  batch_size?: number;
  quality?: string;
  video_duration?: number;
  chars_count?: number;
  mode?: string;
  [key: string]: string | number | boolean | undefined;
}

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

  /**
   * Get detailed info about a specific model (v2 endpoint).
   * GET /api/v2/get_model_info
   */
  async getModelInfo(params: GetModelInfoParams): Promise<ModelInfoV2> {
    return this.client.get<ModelInfoV2>('/api/v2/get_model_info', params);
  }
}
