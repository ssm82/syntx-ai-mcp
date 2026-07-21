import type { VersionInfo, MaintenanceStatus } from '../types';

/**
 * Resource for frontend application metadata.
 * Queries the public syntx.ai domain (not api.syntx.ai).
 */
export class AppResource {
  private readonly baseURL = 'https://syntx.ai';

  /**
   * Get the current deployed app version.
   * GET https://syntx.ai/version.json
   */
  async getVersion(): Promise<VersionInfo> {
    const response = await fetch(`${this.baseURL}/version.json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch version: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Check if the platform is under maintenance.
   * GET https://syntx.ai/maintenance-status.json
   */
  async getMaintenanceStatus(): Promise<MaintenanceStatus> {
    const response = await fetch(`${this.baseURL}/maintenance-status.json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch maintenance status: ${response.status}`);
    }
    return response.json();
  }
}
