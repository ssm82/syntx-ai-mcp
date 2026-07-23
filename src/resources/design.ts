import { BaseClient } from '../client';
import type { DesignSettings } from '../types';
import { applyProviderRules } from './provider-rules';

export interface GenerateDesignParams {
  chat_uuid: string;
  prompt: string;
  settings: DesignSettings;
  /**
   * Provider-specific settings merged into `body.settings` after the typed
   * surface above. Mirrors the SPA's `model_settings` passthrough for
   * `generate-image`. Last-wins over the typed keys above.
   */
  model_settings?: Record<string, unknown>;
}

/**
 * Resource for image/design generation.
 */
export class DesignResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * Generate an image/design.
   * POST /api/v1/design/generate?ai_name={aiName}
   *
   * Normalization: provider-specific rules from `./provider-rules` mutate
   * `settings` in place after the optional `model_settings` merge, so the
   * wire shape matches the SPA's `aiSettingsOnInput` payload (e.g. drop
   * `aspect_ratio` for `grok_i2i_pro`, coerce `seedream` resolutions).
   */
  async generate(aiName: string, params: GenerateDesignParams): Promise<unknown> {
    const settings: Record<string, unknown> = {
      ...params.settings,
      ...(params.model_settings ?? {}),
    };
    applyProviderRules(
      aiName,
      settings,
      {
        modelType: typeof settings.model_type === 'string' ? settings.model_type : '',
      },
      'after',
    );
    return this.client.post<unknown>(
      '/api/v1/design/generate',
      { chat_uuid: params.chat_uuid, prompt: params.prompt, settings },
      { ai_name: aiName },
    );
  }
}
