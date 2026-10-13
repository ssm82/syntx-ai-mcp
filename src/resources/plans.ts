import { BaseClient } from '../client';
import type {
  PlansResponse,
  PromoBannersResponse,
  PlanTariff,
} from '../types';

/**
 * Resource for subscription plans, tariffs, and promo banners.
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
   *
   * `GET /api/v1/promo_banners?lang=…`
   *
   * The live endpoint returns `{header: PromoBanner[], landing: PromoBanner[]}`,
   * not a flat `PromoBanner[]` as the v0.2.x SDK declared. Both groups
   * (in-page header strip and the landing-page slot) are forwarded.
   */
  async getPromoBanners(lang?: string): Promise<PromoBannersResponse> {
    return this.client.get<PromoBannersResponse>('/api/v1/promo_banners', { lang });
  }

  /**
   * List plan tariffs (the actual price list).
   *
   * `GET /api/v1/plans/tariffs?period=monthly|annual`
   *
   * The endpoint 422s on any other `period` value, so the SDK pins the
   * enum rather than letting callers guess. `period` defaults to
   * `monthly` (matches the SPA's default).
   */
  async listTariffs(period: 'monthly' | 'annual' = 'monthly'): Promise<PlanTariff[]> {
    return this.client.get<PlanTariff[]>('/api/v1/plans/tariffs', { period });
  }
}
