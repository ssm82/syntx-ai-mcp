import { BaseClient } from '../client';
import type { PlansResponse, PromoBanner } from '../types';

/**
 * Resource for subscription plans and promo banners.
 */
export class PlansResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * Get all available plans with detailed descriptions.
   * GET /api/v1/plans/card_plans
   */
  async list(lang = 'en'): Promise<PlansResponse> {
    return this.client.get<PlansResponse>('/api/v1/plans/card_plans', { lang });
  }

  /**
   * Get promo banners for a specific language.
   * GET /api/v1/promo_banners
   */
  async getPromoBanners(lang?: string): Promise<PromoBanner[]> {
    return this.client.get<PromoBanner[]>('/api/v1/promo_banners', { lang });
  }
}
