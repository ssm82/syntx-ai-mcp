import { BaseClient } from '../client';
import type { DesignSettings } from '../types';

export interface GenerateDesignParams {
  chat_uuid: string;
  prompt: string;
  settings: DesignSettings;
}

/**
 * Resource for image/design generation.
 */
export class DesignResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * Generate an image/design.
   * POST /api/v1/design/generate?ai_name={aiName}
   */
  async generate(aiName: string, params: GenerateDesignParams): Promise<unknown> {
    return this.client.post<unknown>('/api/v1/design/generate', params, { ai_name: aiName });
  }
}
