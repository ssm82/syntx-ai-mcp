import { BaseClient } from '../client';
import type {
  EventsResponse,
  TokenPricingResponse,
  TrendCategoriesResponse,
  TrendTagsResponse,
} from '../types';

/**
 * Token pricing table.
 *
 * `GET /api/v1/tokens/pricing`
 *
 * Returns `{items: [{id, cost, ...}]}` for the model's per-call token
 * cost. Wire shape is unpinned beyond `id` and `cost`; the rest is
 * forwarded through `unknown`.
 */
export class TokensPricingResource {
  constructor(private readonly client: BaseClient) {}

  async list(): Promise<TokenPricingResponse> {
    return this.client.get<TokenPricingResponse>('/api/v1/tokens/pricing');
  }
}

/**
 * Discovery surfaces used by the SPA's home feed.
 */
export class TrendsResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * `GET /api/v1/trends/categories` — top-level feed categories.
   */
  async categories(): Promise<TrendCategoriesResponse> {
    return this.client.get<TrendCategoriesResponse>('/api/v1/trends/categories');
  }

  /**
   * `GET /api/v1/trends/tags` — free-form tag cloud. The live response
   * has been empty on probe; exposed for forward-compat.
   */
  async tags(): Promise<TrendTagsResponse> {
    return this.client.get<TrendTagsResponse>('/api/v1/trends/tags');
  }
}

/**
 * Event feed (notifications-orthogonal; promotions, milestones, etc.).
 *
 * `GET /api/v1/events?page=N&page_size=N`
 */
export class EventsResource {
  constructor(private readonly client: BaseClient) {}

  async list(page = 1, pageSize = 20): Promise<EventsResponse> {
    return this.client.get<EventsResponse>('/api/v1/events', { page, page_size: pageSize });
  }
}