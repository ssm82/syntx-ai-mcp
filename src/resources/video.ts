import { BaseClient } from '../client';
import type { VideoSettings } from '../types';
import { applyProviderRules } from './provider-rules';

export interface GenerateVideoParams {
  chat_id: string;
  prompt: string;
  settings: VideoSettings;
  file_urls?: string[];
  audio_url?: string;
}

/**
 * Resource for video generation (e.g. wan_video, runway, kling).
 */
export class VideoResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * Generate a video via syntx.ai.
   * POST /api/v1/video/generate?ai_name={aiName}
   *
   * Mirrors `DesignResource.generate` / `AudioResource.generate`. The SPA's
   * `video.js:sendMessage` action sends `{chat_id, prompt, settings, file_urls?,
   * audio_url?}` per the catalog (#35). Note the body field is `chat_id`
   * (NOT `chat_uuid`) — the audio endpoint uses `chat_uuid` but video uses
   * `chat_id`. If a live request fails with 422, verify against the SPA
   * whether the server actually accepts the alternate key.
   *
   * Normalization: provider-specific rules from `./provider-rules` mutate
   * `settings` in place (after the user-supplied `model_settings` merge, when
   * applicable) so the wire shape matches the SPA's `aiSettingsOnInput`
   * payload. Callers do not need to know per-provider quirks (e.g. drop
   * `aspect_ratio` for `grok_i2v`); the rules encode them.
   */
  async generate(aiName: string, params: GenerateVideoParams): Promise<unknown> {
    const settings: Record<string, unknown> = { ...params.settings };
    applyProviderRules(
      aiName,
      settings,
      {
        modelType: typeof settings.model_type === 'string' ? settings.model_type : '',
        fileCount: params.file_urls?.length ?? 0,
      },
      'after',
    );
    return this.client.post<unknown>(
      '/api/v1/video/generate',
      { ...params, settings: settings as VideoSettings },
      { ai_name: aiName },
    );
  }
}
