import { BaseClient } from '../client';
import type { AudioSettings, VoiceExamplesResponse } from '../types';
import { applyProviderRules } from './provider-rules';

export interface ListVoiceExamplesParams {
  page?: number;
  page_size?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface GenerateAudioParams {
  chat_uuid: string;
  prompt: string;
  settings: AudioSettings;
  file_urls?: string[];
  /**
   * Provider-specific settings merged into `body.settings` after the typed
   * surface above. Mirrors the SPA's `model_settings` passthrough for
   * `generate-audio`. Last-wins over the typed keys above.
   */
  model_settings?: Record<string, unknown>;
}

/**
 * Resource for audio generation (e.g. ElevenLabs voices).
 */
export class AudioResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * List voice examples for ElevenLabs.
   * GET /api/v1/audio/elevenlabs/voice_examples
   */
  async listVoiceExamples(params?: ListVoiceExamplesParams): Promise<VoiceExamplesResponse> {
    return this.client.get<VoiceExamplesResponse>('/api/v1/audio/elevenlabs/voice_examples', params);
  }

  /**
   * Generate audio (TTS / music / voice-change) via syntx.ai.
   * POST /api/v1/audio/generate?ai_name={aiName}
   *
   * Mirrors `DesignResource.generate`. The SPA's `audio.js:sendMessage`
   * action sends `{chat_uuid, prompt, settings, file_urls?}`; we mirror that
   * exact body shape. Endpoint reachability confirmed against api.syntx.ai
   * (responds 403 without auth, matching the design endpoint's posture).
   *
   * Normalization: provider-specific rules from `./provider-rules` mutate
   * `settings` in place after the optional `model_settings` merge, so the
   * wire shape matches the SPA's `aiSettingsOnInput` payload (e.g. suno
   * strips `audio_url`/`continue_at`/source keys in `mode==='generate'`).
   */
  async generate(aiName: string, params: GenerateAudioParams): Promise<unknown> {
    const settings: Record<string, unknown> = {
      ...params.settings,
      ...(params.model_settings ?? {}),
    };
    applyProviderRules(
      aiName,
      settings,
      {
        modelType: typeof settings.model_type === 'string' ? settings.model_type : '',
        fileCount: params.file_urls?.length ?? 0,
      },
      'after',
    );
    const { model_settings: _ignored, ...rest } = params;
    void _ignored;
    return this.client.post<unknown>(
      '/api/v1/audio/generate',
      { ...rest, settings },
      { ai_name: aiName },
    );
  }
}
