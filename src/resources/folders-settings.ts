import { BaseClient } from '../client';
import type { Folder, Locale, AppSettings } from '../types';

/**
 * Resource for folders (chat organization).
 */
export class FoldersResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * List text folders.
   * GET /api/v1/folders/text/list
   */
  async listTextFolders(): Promise<Folder[]> {
    return this.client.get<Folder[]>('/api/v1/folders/text/list');
  }

  /**
   * List image folders.
   * GET /api/v1/folders/image/list
   */
  async listImageFolders(): Promise<Folder[]> {
    return this.client.get<Folder[]>('/api/v1/folders/image/list');
  }

  /**
   * List video folders.
   * GET /api/v1/folders/video/list
   */
  async listVideoFolders(): Promise<Folder[]> {
    return this.client.get<Folder[]>('/api/v1/folders/video/list');
  }

  /**
   * List audio folders.
   * GET /api/v1/folders/audio/list
   */
  async listAudioFolders(): Promise<Folder[]> {
    return this.client.get<Folder[]>('/api/v1/folders/audio/list');
  }
}

/**
 * Resource for application settings and localizations.
 */
export class SettingsResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * Get application-wide settings (OAuth providers, available AI list, IP, country).
   * GET /api/v1/settings
   */
  async get(): Promise<AppSettings> {
    return this.client.get<AppSettings>('/api/v1/settings');
  }

  /**
   * Get available UI locales.
   * GET /api/v1/i18n/locales
   */
  async getLocales(lang?: string, namespace?: string): Promise<Locale[]> {
    return this.client.get<Locale[]>('/api/v1/i18n/locales', { lang, namespace });
  }
}
