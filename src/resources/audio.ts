import { BaseClient } from '../client';
import type { VoiceExamplesResponse } from '../types';

export interface ListVoiceExamplesParams {
  page?: number;
  page_size?: number;
  [key: string]: string | number | boolean | undefined;
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
}
